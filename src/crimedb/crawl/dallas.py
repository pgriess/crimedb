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
import logging
import pyproj
import pytz


__SOCRATA_HOSTNAME = 'www.dallasopendata.com'

__SOCRATA_DATASET = 'tbnj-w5hb'

__LOGGER = logging.getLogger(__name__)

__TZ = pytz.timezone('US/Central')

# Guessed that PointX, PointY are in SPCS/NAD83. This appears correct based on
# spot-checking a few locations with their geocoded addresses.
__PROJ = pyproj.Proj(init='nad83:4202', units='us-ft', preserve_units=True)

def crimes(work_dir, download=True, **kwargs):
    '''
    Iterator which yields Crime objects.
    '''

    for cr in crimedb.socrata.dataset_rows(
            __SOCRATA_HOSTNAME, __SOCRATA_DATASET):
        ts = None
        if 'startdatetime' in cr:
            ts = crimedb.socrata.floating_timestamp_to_datetime(
                    cr['startdatetime'], __TZ)

        loc = None
        if 'pointx' in cr and 'pointy' in cr:
            loc = __PROJ(float(cr['pointx']),
                    float(cr['pointy']),
                    inverse=True,
                    errcheck=True)

        yield crimedb.core.Crime(cr['offincident'], ts, loc)
