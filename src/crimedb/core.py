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
Core classes and methods for CrimeDB.
'''

import datetime

RFC3999_STRFTIME_FORMAT = '%Y-%m-%dT%H:%M:%S%z'


class Crime:
    '''
    A single crime.
    '''
    
    def __init__(self, description, time, location):
        '''
        Create a new Crime object.

        The location field is a (lon, lat) tuple in WGS84 coordinates.
        '''

        self.description = description
        self.time = time
        self.location = location


def crime2json_obj(crime):
    '''
    Return a Python object representing the given crime suitable for
    converting to JSON.
    '''

    jo = {
        'description': crime.description,
        'time': crime.time.strftime(RFC3999_STRFTIME_FORMAT),
    }

    if crime.location:
        jo['geo'] = {
            'type': 'Point',
            'coordinates': crime.location,
        }

    return jo


def json_obj2crime(jo):
    '''
    The inverse of crime2json_obj().
    '''

    description = jo['description']
    time = datetime.datetime.strptime(
            jo['time'], RFC3999_STRFTIME_FORMAT)

    location = None
    if 'geo' in jo:
        location = tuple(jo['geo']['coordinates'])

    return Crime(description, time, location)

