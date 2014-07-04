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

import csv
import crimedb.core
import crimedb.geocoding
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


__BASE_URL = 'http://www.slmpd.org/CrimeReport.aspx'

# Per the FAQ http://www.slmpd.org/Crime/CrimeDataFrequentlyAskedQuestions.pdf,
# (XCoord, YCoord) is NAD83.
__PROJ = pyproj.Proj(
    init='nad83:2401', units='us-ft', preserve_units=True)

__TZ = pytz.timezone('US/Central')

__LOGGER = logging.getLogger(__name__)


# Return a map of global form fields from the ElementTree of a TOC page.
def __toc_global_form_fields(et):
    global_form_fields = {
            '__EVENTTARGET': '',
            '__EVENTARGUMENT': ''}
    for i in et.xpath('//input[@type="hidden"]'):
        global_form_fields[i.get('name')] = i.get('value')

    return global_form_fields


# Iterator which yields a file-like object of the HTML content of
# each of the TOC pages, in reverse chronological order.
def __toc_pages():
    next_num = 2
    form_data = None

    while True:
        r = urllib.request.urlopen(__BASE_URL, data=form_data)
        body = r.read()
        yield io.BytesIO(body)

        et = lxml.etree.parse(io.BytesIO(body), lxml.etree.HTMLParser())
        form_fields = __toc_global_form_fields(et)
        page_string = 'Page${}'.format(next_num)

        next_a = et.xpath(
                '//a[@href="javascript:__doPostBack(\'GridView1\',\'{}\')"]'.format(page_string))
        if not next_a:
            break

        form_fields['__EVENTTARGET'] = 'GridView1'
        form_fields['__EVENTARGUMENT'] = page_string

        next_num += 1
        form_data = urllib.parse.urlencode(form_fields).encode('utf-8')


# Iterator which yields (filename, callable) tuples of each CSV file
# on a given TOC page. When invoked, the callable will return a
# stream of file contents.
def __toc_page_files(tp):
    et = lxml.etree.parse(tp, lxml.etree.HTMLParser())
    global_form_fields = __toc_global_form_fields(et)

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
            __LOGGER.debug('downloading {}'.format(fa.text))

            file_form_fields = global_form_fields.copy()
            file_form_fields['__EVENTTARGET'] = m.group(1)
            form_data = urllib.parse.urlencode(file_form_fields).encode('utf-8')

            return urllib.request.urlopen(__BASE_URL, data=form_data)

        yield fa.text, download_file


def __cache_dir(work_dir):
    cache_dir = os.path.join(work_dir, 'raw')
    os.makedirs(cache_dir, exist_ok=True)

    return cache_dir


def __intermediate_dir(work_dir):
    int_dir = os.path.join(work_dir, 'intermediate')
    os.makedirs(int_dir, exist_ok=True)

    return int_dir


# Download any missing raw files and place them in the appropriate location in
# the work directory. Returns paths to the files downloaded.
def __download_raw_files(work_dir):
    cache_dir = __cache_dir(work_dir)
    file_paths = []

    for tp in __toc_pages():
        for file_name, file_fetch in __toc_page_files(tp):
            file_path = os.path.join(cache_dir, file_name)

            if os.path.exists(file_path):
                __LOGGER.debug('found {}; skipping'.format(file_name))
                continue

            with open(file_path, 'wb') as rf:
                rf.write(file_fetch().read())

            file_paths += [file_path]

    return file_paths


# Process the given raw file and update JSON files in the work
# directory.
def __process_raw_file(work_dir, file_path, geocoder, region):
    __LOGGER.info('processing STL file {}'.format(
            os.path.basename(file_path)))

    def write_crime_dict(crime_dict, loc):
        if loc:
            crime_point = shapely.geometry.Point(*loc)
            if region and not region.contains(crime_point):
                __LOGGER.debug(
                        ('crime on row {row} at ({lon}, {lat}) is outside '
                         'of our region; stripping location').format(
                             row=crime_dict['_row_num'], lon=loc[0], lat=loc[1]))
                loc = None

        date = datetime.datetime.strptime(
                crime_dict['DateOccur'],
                '%m/%d/%Y %H:%M')

        c = crimedb.core.Crime(
                crime_dict['Description'],
                __TZ.localize(date), loc)

        int_fp = os.path.join(
                __intermediate_dir(work_dir),
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
                loc = __PROJ(
                        float(crime_dict['XCoord']),
                        float(crime_dict['YCoord']),
                        inverse=True, errcheck=True)

            write_crime_dict(crime_dict, loc)

    for cd, loc in zip(
            geocoding_needed,
            geocoder(map(crime_dict_loc, geocoding_needed))):
        if loc:
            loc = loc['coordinates']
            __LOGGER.debug('resolved {addr} to ({lon}, {lat})'.format(
                    addr=crime_dict_loc(cd), lon=loc[0], lat=loc[1]))
        else:
            __LOGGER.debug('failed to resolve {addr}'.format(
                    addr=crime_dict_loc(cd)))

        write_crime_dict(cd, loc)


def crimes(work_dir, geocoder=crimedb.geocoding.geocode_null,
           region=None, download=True, **kwargs):
    '''
    Iterator which yields Crime objects.

    'work_dir' is a filesystem directory with which to maintain state across
    processing runs.

    'download' indiciates whether or not to download new files.

    'geocoder' is a generator function that takes an interator of
    addresses and emits locations (or None on failure)

    'region' is a shapely.geometry object describing the region for
    which we're fetching crimes; locations will be constrained such
    that they're within this area
    '''

    if download:
        for fp in __download_raw_files(work_dir):
            __process_raw_file(work_dir, fp, geocoder, region)

    int_dir = __intermediate_dir(work_dir)

    for file_name in os.listdir(int_dir):
        fp = os.path.join(int_dir, file_name)
        with open(fp, 'rt', encoding='utf-8', errors='replace') as rf:
            for l in rf:
                yield crimedb.core.json_obj2crime(
                        json.loads(l.strip()))
