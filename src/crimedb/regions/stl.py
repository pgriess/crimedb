# Copyright 2014 Peter Griess
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

'''
Process crime data from the St. Louis Police Department at
http://www.slmpd.org/Crimereports.shtml.
'''

import contextlib
import csv
import crimedb.core
import crimedb.geocoding
import crimedb.regions.base
import datetime
import io
import json
import logging
import lxml, lxml.etree
import os.path
import pyproj
import pytz
import re
import shapely.geometry
import urllib.request, urllib.parse


_BASE_URL = 'http://www.slmpd.org/CrimeReport.aspx'

# Per the FAQ http://www.slmpd.org/Crime/CrimeDataFrequentlyAskedQuestions.pdf,
# (XCoord, YCoord) is NAD83.
_PROJ = pyproj.Proj(
    init='nad83:2401', units='us-ft', preserve_units=True)

_TZ = pytz.timezone('US/Central')

_LOGGER = logging.getLogger(__name__)


class Region(crimedb.regions.base.Region):

    def __init__(self, *args, **kwargs):
        super(Region, self).__init__('stl', *args, **kwargs)

        self.human_name = 'St. Louis City, MO'
        self.human_url = 'http://www.slmpd.org/'

    def download(self):
        self._download_raw_files()

    def process(self, geocoder):
        for fn in os.listdir(self._cache_dir()):

            self._process_raw_file(
                    os.path.join(self._cache_dir(), fn),
                    geocoder)

    def crimes(self):
        int_dir = self._intermediate_dir()

        for file_name in os.listdir(int_dir):
            fp = os.path.join(int_dir, file_name)
            with open(fp, 'rt', encoding='utf-8', errors='replace') as rf:
                for l in rf:
                    yield crimedb.core.json_obj2crime(
                            json.loads(l.strip()))

    def _download_raw_files(self):
        '''
        Downlaod all raw CVS files and store them in the cache directory.
        '''

        for tp in self._toc_pages():
            for file_name, file_fetch in self._toc_page_files(tp):
                file_path = os.path.join(self._cache_dir(), file_name)

                if os.path.exists(file_path):
                    _LOGGER.debug('found {}; skipping'.format(file_name))
                    continue

                with open(file_path, 'wb') as rf:
                    with contextlib.closing(file_fetch()) as f:
                        rf.write(f.read())

    def _toc_global_form_fields(self, et):
        '''
        Return a map of global form fields from the ElementTree of a TOC page.
        '''

        global_form_fields = {
                '__EVENTTARGET': '',
                '__EVENTARGUMENT': ''}
        for i in et.xpath('//input[@type="hidden"]'):
            global_form_fields[i.get('name')] = i.get('value')

        return global_form_fields


    def _toc_pages(self):
        '''
        Iterator which yields a file-like object of the HTML content of each of the
        TOC pages, in reverse chronological order.
        '''

        next_num = 2
        form_data = None

        while True:
            with contextlib.closing(urllib.request.urlopen(_BASE_URL, data=form_data)) as r:
                body = r.read()
                yield io.BytesIO(body)

            et = lxml.etree.parse(io.BytesIO(body), lxml.etree.HTMLParser())
            form_fields = self._toc_global_form_fields(et)
            page_string = 'Page${}'.format(next_num)

            next_a = et.xpath(
                    '//a[@href="javascript:__doPostBack(\'GridView1\',\'{}\')"]'.format(page_string))
            if not next_a:
                break

            form_fields['__EVENTTARGET'] = 'GridView1'
            form_fields['__EVENTARGUMENT'] = page_string

            next_num += 1
            form_data = urllib.parse.urlencode(form_fields).encode('utf-8')


    def _toc_page_files(self, tp):
        '''
        Iterator which yields (filename, callable) tuples of each CSV file on a
        given TOC page. When invoked, the callable will return a stream of file
        contents.
        '''

        et = lxml.etree.parse(tp, lxml.etree.HTMLParser())
        global_form_fields = self._toc_global_form_fields(et)

        file_anchors = [
            a for a in et.xpath('//a[@id]')
                if re.match(r'^GridView1.*downloadD', a.get('id')) and
                    a.get('href')]
        for fa in file_anchors:
            if not fa.get('href'):
                continue

            m = re.match(
                    r'^javascript:__doPostBack\(\'([^\']+)',
                    fa.get('href'))
            if not m:
                continue

            def download_file():
                _LOGGER.debug('downloading {}'.format(fa.text))

                file_form_fields = global_form_fields.copy()
                file_form_fields['__EVENTTARGET'] = m.group(1)
                form_data = urllib.parse.urlencode(file_form_fields).encode('utf-8')

                return urllib.request.urlopen(_BASE_URL, data=form_data)

            yield fa.text, download_file

    def _process_raw_file(self, file_path, geocoder):
        '''
        Process the given raw file and update intermediate files in the work
        directory.
        '''

        file_name = os.path.basename(file_path)
        _LOGGER.info('processing STL file {}'.format(file_name))

        def crime_id(crime_dict):
            return bytes('{}:{}'.format(
                    file_name, crime_dict['_row_num']), encoding='utf-8')

        def write_crime_dict(crime_dict, loc):
            if loc:
                crime_point = shapely.geometry.Point(*loc)
                if self.shape and not self.shape.contains(crime_point):
                    _LOGGER.debug(
                            ('crime at ({lon}, {lat}) is outside '
                             'of our shape; stripping location').format(
                                 lon=loc[0], lat=loc[1]))
                    loc = None

            date = datetime.datetime.strptime(
                    crime_dict['DateOccur'],
                    '%m/%d/%Y %H:%M')

            c = crimedb.core.Crime(
                    crime_dict['Description'],
                    _TZ.localize(date), loc)

            int_fp = os.path.join(
                    self._intermediate_dir(),
                    datetime.datetime.strftime(date, '%Y-%m'))

            with open(int_fp, 'at', encoding='utf-8', errors='replace') as f:
                f.write(json.dumps(crimedb.core.crime2json_obj(c)))
                f.write('\n')


        def crime_dict_loc(cd):
            return '{ILEADSAddress} {ILEADSStreet}, Saint Louis, Missouri'.format(**cd)


        geocoding_needed = []

        with open(file_path, 'rt', encoding='utf-8', errors='replace') as f:
            cols = None
            events = []

            csv_reader = csv.reader(f)
            row_num = 0
            for crime_row in csv_reader:
                row_num += 1

                if cols is None:
                    # Normalize field names that can differ in some months
                    if 'DateOccured' in crime_row:
                        crime_row[crime_row.index('DateOccured')] = 'DateOccur'

                    cols = crime_row
                    continue

                crime_dict = dict(zip(cols, crime_row))
                crime_dict['_row_num'] = row_num

                if float(crime_dict['XCoord']) == 0 and \
                        float(crime_dict['YCoord']) == 0:
                    if not crime_dict['ILEADSAddress'].strip() or \
                            not crime_dict['ILEADSStreet'].strip():
                        loc = None
                    else:
                        geocoding_needed += [crime_dict]
                        continue
                else:
                    loc = _PROJ(
                            float(crime_dict['XCoord']),
                            float(crime_dict['YCoord']),
                            inverse=True, errcheck=True)

                write_crime_dict(crime_dict, loc)

        for cd, loc in zip(
                geocoding_needed,
                geocoder(map(crime_dict_loc, geocoding_needed))):
            if loc:
                loc = loc['coordinates']
                _LOGGER.debug('resolved {addr} to ({lon}, {lat})'.format(
                        addr=crime_dict_loc(cd), lon=loc[0], lat=loc[1]))
            else:
                _LOGGER.debug('failed to resolve {addr}'.format(
                        addr=crime_dict_loc(cd)))

            write_crime_dict(cd, loc)
