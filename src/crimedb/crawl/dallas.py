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
Process crime data from Dallas, TX Police Department.
'''

import crimedb.core
import crimedb.socrata
import datetime
import json
import logging
import os
import os.path
import pyproj
import pytz


__SOCRATA_HOSTNAME = 'www.dallasopendata.com'

__SOCRATA_DATASET = 'tbnj-w5hb'

__LOGGER = logging.getLogger(__name__)

__TZ = pytz.timezone('US/Central')

# Guessed that PointX, PointY are in SPCS/NAD83. This appears correct based on
# spot-checking a few locations with their geocoded addresses.
__PROJ = pyproj.Proj(init='nad83:4202', units='us-ft', preserve_units=True)


def __cache_dir(work_dir):
    cache_dir = os.path.join(work_dir, 'raw')
    os.makedirs(cache_dir, exist_ok=True)

    return cache_dir


def __intermediate_dir(work_dir):
    int_dir = os.path.join(work_dir, 'intermediate')
    os.makedirs(int_dir, exist_ok=True)

    return int_dir


def download(work_dir, **kwargs):
    '''
    Download any missing data.
    '''

    # Get the list of IDs that we've already seen
    gids = set()
    incidents_path = os.path.join(__cache_dir(work_dir), 'incidents')
    if os.path.exists(incidents_path):
        with open(incidents_path, 'rt', encoding='utf-8') as f:
            for l in f:
                incident = json.loads(l)
                gids.add(incident['servicenum'])

    # Write our all new incidents that don't already appear in the file
    with open(incidents_path, 'at', encoding='utf-8') as f:
        for cr in crimedb.socrata.dataset_rows(
                __SOCRATA_HOSTNAME, __SOCRATA_DATASET):
            if cr['servicenum'] in gids:
                continue

            f.write(json.dumps(cr) + '\n')


def process(work_dir, geocoder=crimedb.geocoding.geocode_null, region=None,
            **kwargs):
    '''
    Process downloaded files.
    '''

    incidents_path = os.path.join(__cache_dir(work_dir), 'incidents')
    if not os.path.exists(incidents_path):
        return

    with open(incidents_path, 'rt', encoding='utf-8') as f:
        for cr in map(json.loads, f):
            date = None
            if 'startdatetime' in cr:
                date = crimedb.socrata.floating_timestamp_to_datetime(
                        cr['startdatetime'], __TZ)

            loc = None
            if 'pointx' in cr and 'pointy' in cr:
                loc = __PROJ(float(cr['pointx']),
                        float(cr['pointy']),
                        inverse=True,
                        errcheck=True)

            c = crimedb.core.Crime(cr['offincident'], date, loc)

            int_fp = os.path.join(__intermediate_dir(work_dir), 'UNKNOWN')
            if date:
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
