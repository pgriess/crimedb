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
import urllib.parse
import urllib.request


__QUERY_URL = ('http://maptest.stlouisco.com/arcgis/rest/services/'
               'Police/AGS_Crimes/MapServer/0/query')

__TZ = pytz.timezone('US/Central')

__LOGGER = logging.getLogger(__name__)

def __cache_dir(work_dir):
    cache_dir = os.path.join(work_dir, 'raw')
    os.makedirs(cache_dir, exist_ok=True)

    return cache_dir


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


def crimes(work_dir, download=True, **kwargs):
    '''
    Iterator which yields Crime objects.
    '''

    if download:
        __download(work_dir)

    # XXX: We should really get this from the 'spatialReference'
    #      'latestWkid' field in the results object. Unfortunately
    #      the current fetching/caching strategy doesn't really
    #      accommodate this very well. Probably worth re-visiting.
    proj = pyproj.Proj(init='epsg:3857')

    incidents_path = os.path.join(__cache_dir(work_dir), 'incidents')
    if not os.path.exists(incidents_path):
        return

    with open(incidents_path, 'rt', encoding='utf-8') as f:
        for l in f:
            fo = json.loads(l)

            attrs = fo['attributes']
            geom = fo['geometry']

            loc = proj(geom['x'], geom['y'],
                       inverse=True, errcheck=True)

            c = crimedb.core.Crime(
                    attrs['Offense'],
                    datetime.datetime.fromtimestamp(
                            attrs['Date'] / 1000,
                            __TZ),
                    loc)

            yield c
