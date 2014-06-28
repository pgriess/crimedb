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
import datetime
import io
import logging
import lxml, lxml.etree
import os.path
import pyproj
import pytz
import re
import shapely.geometry
import urllib.request, urllib.parse


__BASE_URL = 'http://www.slmpd.org/CrimeReport.aspx'

__SPCS_PROJ = pyproj.Proj(
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


# Iterator which yields (filename, contents) tuples of each CSV file
# on a given TOC page.
def __toc_page_files(tp, cache_dir=None):
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

        fn = fa.text
        if cache_dir:
            fp = os.path.join(cache_dir, fn)

        response = None
        if not cache_dir or not os.path.exists(fp):
            __LOGGER.debug('{} not found in cache; downloading'.format(fn))

            file_form_fields = global_form_fields.copy()
            file_form_fields['__EVENTTARGET'] = m.group(1)
            form_data = urllib.parse.urlencode(file_form_fields).encode('utf-8')
            response = urllib.request.urlopen(__BASE_URL, data=form_data)

        if cache_dir and response:
            with open(fp, 'wb') as cf:
                cf.write(response.read())

        if cache_dir:
            with open(fp, 'rb') as cf:
                yield fn, cf
        else:
            assert response
            yield fn, response


def crimes(cache_dir=None, region=None):
    '''
    Iterator which yields Crime objects.

    This hits the St. Louis Police Department server and downloads all CSV
    files. It is not a cheap operation.

    cache_dir is a filesystem directory with which to maintain a
    cache of downloaded files. If None, files will always be
    downloaded and never cached.

    region is an shapely.geometry object describing the region for
    which we're collecting data. Any crimes found to be outside this
    area will be discarded.
    '''

    for tp in __toc_pages():
        for file_name, file_contents in __toc_page_files(
                tp, cache_dir=cache_dir):
            __LOGGER.debug(
                    'processing STL file: {}'.format(file_name))

            cols = None
            events = []

            csv_reader = csv.reader(
                    io.TextIOWrapper(file_contents, encoding='utf-8',
                                     errors='replace')
            )
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

                loc = __SPCS_PROJ(
                        float(crime_dict['XCoord']),
                        float(crime_dict['YCoord']),
                        inverse=True, errcheck=True)
                crime_point = shapely.geometry.Point(*loc)
                if region and not region.contains(crime_point):
                    __LOGGER.debug(
                            ('crime on row {row} at ({lon}, {lat}) is outside of our region; '
                             'stripping location').format(
                                 row=row_num, lon=loc[0], lat=loc[1]))
                    loc = None

                date = datetime.datetime.strptime(
                        crime_dict['DateOccur'],
                        '%m/%d/%Y %H:%M')

                yield crimedb.core.Crime(
                        crime_dict['Description'],
                        __TZ.localize(date), loc)
