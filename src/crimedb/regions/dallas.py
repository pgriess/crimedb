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
import crimedb.regions.base
import crimedb.socrata
import datetime
import json
import logging
import os
import os.path
import pyproj
import pytz
import shapely.geometry


_SOCRATA_HOSTNAME = 'www.dallasopendata.com'

_SOCRATA_DATASET = 'tbnj-w5hb'

_LOGGER = logging.getLogger(__name__)

_TZ = pytz.timezone('US/Central')

# Guessed that PointX, PointY are in SPCS/NAD83. This appears correct based on
# spot-checking a few locations with their geocoded addresses.
_PROJ = pyproj.Proj(init='nad83:4202', units='us-ft', preserve_units=True)


class Region(crimedb.regions.base.Region):

    def __init__(self, *args, **kwargs):
        super(Region, self).__init__('dallas', *args, **kwargs)

        self.human_name = 'Dallas, TX'
        self.human_url = 'http://www.dallaspolice.net/'

    def download(self):
        # Get the list of IDs that we've already seen
        gids = set()
        if os.path.exists(self._incidents_path()):
            with open(self._incidents_path(), 'rt', encoding='utf-8') as f:
                for l in f:
                    incident = json.loads(l)
                    gids.add(incident['servicenum'])

        # Write our all new incidents that don't already appear in the file
        with open(self._incidents_path(), 'at', encoding='utf-8') as f:
            for cr in crimedb.socrata.dataset_rows(
                    _SOCRATA_HOSTNAME, _SOCRATA_DATASET):
                if cr['servicenum'] in gids:
                    continue

                f.write(json.dumps(cr) + '\n')

    def process(self):
        if not os.path.exists(self._incidents_path()):
            return

        with open(self._incidents_path(), 'rt', encoding='utf-8') as f:
            for cr in map(json.loads, f):
                date = None
                if 'startdatetime' in cr:
                    date = crimedb.socrata.floating_timestamp_to_datetime(
                            cr['startdatetime'], _TZ)

                loc = None
                if 'pointx' in cr and 'pointy' in cr:
                    loc = _PROJ(float(cr['pointx']),
                            float(cr['pointy']),
                            inverse=True,
                            errcheck=True)

                if loc:
                    point = shapely.geometry.Point(*loc)
                    if self.shape and not self.shape.contains(point):
                        _LOGGER.debug(
                                ('crime at ({lon}, {lat}) is outside of our'
                                 'shape; stripping location').format(
                                     lon=loc[0], lat=loc[1]))
                        loc = None

                c = crimedb.core.Crime(cr['offincident'], date, loc)

                int_fp = os.path.join(self._intermediate_dir(), 'UNKNOWN')
                if date:
                    int_fp = os.path.join(
                            self._intermediate_dir(),
                            datetime.datetime.strftime(date, '%y-%m'))

                with open(int_fp, 'at', encoding='utf-8', errors='replace') as f:
                    f.write(json.dumps(crimedb.core.crime2json_obj(c)))
                    f.write('\n')


    def crimes(self):
        for file_name in os.listdir(self._intermediate_dir()):
            fp = os.path.join(self._intermediate_dir(), file_name)
            with open(fp, 'rt', encoding='utf-8', errors='replace') as rf:
                for l in rf:
                    yield crimedb.core.json_obj2crime(
                            json.loads(l.strip()))

    def _incidents_path(self):
        return os.path.join(self._cache_dir(), 'incidents')
