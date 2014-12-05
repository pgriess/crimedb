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
# Reference for Socrata SODA API:
#
#   http://dev.socrata.com/docs/endpoints.html

'''
Utilities for interacting with Socrata datasets.
'''

import datetime
import io
import json
import logging
import urllib.request

__LOGGER = logging.getLogger(__name__)

__PAGESZ = 20000

def floating_timestamp_to_datetime(ts, tz=None):
    '''
    Return a datetime.datetime object for the given Socrata floating timestamp.

    http://dev.socrata.com/docs/datatypes/timestamp.html
    '''

    d = datetime.datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S')
    if tz:
        d = tz.localize(d)

    return d


# It would be nice to load this via CSV rather than JSON, as the former lends
# itself to easier incremental parsing via included libraries. JSON can be
# incrementally parsed via ijson, but it's not available via MacPorts so punt
# for now. We choose JSON here because it allows access to internal Socrata
# fields which CSV does not.
def dataset_rows(api_host, dataset_id, system_fields=False):
    '''
    Iterator for rows in the given dataset. Each row is a Python dictionary.
    '''

    offset = 0
    while True:
        __LOGGER.debug('Fetching rows [{}, {}) from {}'.format(
                offset, offset + __PAGESZ, dataset_id))
        url = ('http://{host}/resource/{dataset_id}.json?'
               '$offset={off}&$limit={lim}&$$exclude_system_fields={sys}').format(
                host=api_host, dataset_id=dataset_id, off=offset, lim=__PAGESZ,
                sys=not system_fields)
        rows = json.load(io.TextIOWrapper(urllib.request.urlopen(url),
                                          encoding='utf-8',
                                          errors='replace'))
        for r in rows:
            yield r

        if len(rows) < __PAGESZ:
            break

        offset += len(rows)
