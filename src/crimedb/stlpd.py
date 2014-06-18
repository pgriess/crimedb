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
import pyproj
import pytz
import re
import urllib.request, urllib.parse

__BASE_URL = 'http://www.slmpd.org/CrimeReport.aspx'

__SPCS_PROJ = pyproj.Proj(
    init='nad83:2401', units='us-ft', preserve_units=True)

__TZ = pytz.timezone('US/Central')

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

        file_form_fields = global_form_fields.copy()
        file_form_fields['__EVENTTARGET'] = m.group(1)
        r = urllib.request.urlopen(
                __BASE_URL,
                data=urllib.parse.urlencode(file_form_fields).encode('utf-8'))

        yield fa.text, r


def crimes():
    '''
    Iterator which yields Crime objects.

    This hits the STLPD server and downloads all CSV files. It is not a cheap
    operation.
    '''

    for tp in __toc_pages():
        for file_name, file_contents in __toc_page_files(tp):
            logging.debug(
                    'processing STLPD file: {}'.format(file_name))

            cols = None
            events = []

            csv_reader = csv.reader(
                    io.TextIOWrapper(file_contents, encoding='utf-8'))
            for crime_row in csv_reader:
                if cols is None:
                    cols = crime_row
                    continue

                crime_dict = dict(zip(cols, crime_row))
                lat, lon = __SPCS_PROJ(
                        float(crime_dict['XCoord']),
                        float(crime_dict['YCoord']),
                        inverse=True, errcheck=True)
                date = datetime.datetime.strptime(
                        crime_dict['DateOccur'],
                        '%m/%d/%Y %H:%M')
                yield crimedb.core.Crime(
                    crime_dict['Description'],
                    __TZ.localize(date),
                    [lon, lat])
