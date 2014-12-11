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
#
# Reference for ArcGIS REST API:
#
#   http://resources.arcgis.com/en/help/rest/apiref/index.html
#
# NOTES:
#
#   - OBJECTIDs get re-used when incidents are deleted. Order of events by date
#     is not the same as order by OBJECTID as a result of this.
#   - Can use &returnIdsOnly=true to get a list of OBJECTIDs; no
#     limit to size of result set
#   - GlobalIDs are unique, random
#
#   Plan:
#       - Maintain a list of all GlobalIDs seen
#       - Page through all GlobalIDs 5k at a time (max page size) to see
#         what's new
#       - Append records as JSON objects (one per line) to a single master
#         file. This can serve as both our record of all GlobalIDs seen, and
#         a cache to allow re-processing

'''
Process crime data from the St. Louis County Police Department at
http://maps.stlouisco.com/police.
'''

import crimedb.core
import datetime
import io
import json
import logging
import os.path
import pyproj
import pytz
import shapely.geometry
import urllib.parse
import urllib.request


__QUERY_URL = ('http://maps.stlouisco.com/arcgis/rest/services/'
               'Police/AGS_Crimes/MapServer/0/query')

__TZ = pytz.timezone('US/Central')

__LOGGER = logging.getLogger(__name__)

# XXX: We should really get this from the 'spatialReference'
#      'latestWkid' field in the results object. Unfortunately
#      the current fetching/caching strategy doesn't really
#      accommodate this very well. Probably worth re-visiting.
__PROJ = pyproj.Proj(init='epsg:3857')


def __cache_dir(work_dir):
    cache_dir = os.path.join(work_dir, 'raw')
    os.makedirs(cache_dir, exist_ok=True)

    return cache_dir


def __intermediate_dir(work_dir):
    int_dir = os.path.join(work_dir, 'intermediate')
    os.makedirs(int_dir, exist_ok=True)

    return int_dir


def __download(work_dir):
    cache_dir = __cache_dir(work_dir)

    # Get the list of GlobalIDs that we've already seen
    gids = set()
    incidents_path = os.path.join(cache_dir, 'incidents')
    if os.path.exists(incidents_path):
        with open(incidents_path, 'rt', encoding='utf-8') as f:
            for l in f:
                incident = json.loads(l)
                gids.add(incident['attributes']['GlobalID'])

    # Page through the list of incidents, saving any of those that
    # we haven't already seen
    query_params = {
            'f': 'json',
            'returnGeometry': 'true',
            'outFields': '*',
            'outSR': '102100',
            'orderByFields': 'GlobalID',
    }

    last_gid = '{00000000-0000-0000-0000-000000000000}'
    while True:
        __LOGGER.debug('fetching GlobalIDs > {}'.format(last_gid))
        query_params['where'] = "GlobalID>'{}'".format(last_gid)
        url = '{}?{}'.format(__QUERY_URL, urllib.parse.urlencode(query_params))
        ro = json.load(io.TextIOWrapper(urllib.request.urlopen(url),
                                        encoding='utf-8',
                                        errors='replace'))

        __LOGGER.debug('got {} features'.format(len(ro['features'])))

        # No records with a larger GlobalID; we're done
        if not ro['features']:
            break

        with open(incidents_path, 'at', encoding='utf-8') as f:
            for feature in ro['features']:
                last_gid = feature['attributes']['GlobalID']
                if last_gid in gids:
                    continue

                f.write(json.dumps(feature) + '\n')


def download(work_dir, **kwargs):
    '''
    Download any missing data.
    '''

    __download(work_dir)


def process(work_dir, geocoder=crimedb.geocoding.geocode_null, region=None,
            **kwargs):
    '''
    Process downloaded files.
    '''

    incidents_path = os.path.join(__cache_dir(work_dir), 'incidents')
    if not os.path.exists(incidents_path):
        return

    with open(incidents_path, 'rt', encoding='utf-8') as f:
        for l in f:
            fo = json.loads(l)

            attrs = fo['attributes']
            geom = fo['geometry']

            loc = __PROJ(geom['x'], geom['y'], inverse=True, errcheck=True)
            point = shapely.geometry.Point(*loc)
            if region and not region.contains(point):
                __LOGGER.debug(
                        ('crime {cid} at ({lon}, {lat}) is outside of our'
                         'region; stripping location').format(
                             cid=attrs['GlobalID'], lon=loc[0], lat=loc[1]))
                loc = None

            date = datetime.datetime.fromtimestamp(attrs['Date'] / 1000, __TZ)

            c = crimedb.core.Crime(attrs['Offense'], date, loc)

            int_fp = os.path.join(
                    __intermediate_dir(work_dir),
                    datetime.datetime.strftime(date, '%y-%m'))

            with open(int_fp, 'at', encoding='utf-8', errors='replace') as f:
                f.write(json.dumps(crimedb.core.crime2json_obj(c)))
                f.write('\n')


def crimes(work_dir, download=True, **kwargs):
    '''
    Iterator which yields Crime objects.
    '''

    int_dir = __intermediate_dir(work_dir)

    for file_name in os.listdir(int_dir):
        fp = os.path.join(int_dir, file_name)
        with open(fp, 'rt', encoding='utf-8', errors='replace') as rf:
            for l in rf:
                yield crimedb.core.json_obj2crime(
                        json.loads(l.strip()))
