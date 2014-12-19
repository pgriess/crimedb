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
Base class for region implementations.
'''

import io
import json
import os
import os.path
import pkg_resources
import shapely.geometry


class Region(object):
    '''
    Base class for all regions.

    Provides support for common operations and provides a common API for use in
    other code.
    '''

    def __init__(self, name, work_dir=None, shape=None):
        self.name = name
        self.work_dir = work_dir

        if not shape:
            with pkg_resources.resource_stream(__name__, '{}.geojson'.format(name)) as f:
                tf = io.TextIOWrapper(f, encoding='utf-8', errors='replace')
                shape = shapely.geometry.shape(json.load(tf))
        self.shape = shape

        self.human_name = None
        self.human_url = None

    def download(self):
        '''
        Download any new crime incidents.

        This requires network access and may take along time to execute
        depending on the specifics of the region implementation (some regions
        have faster/slower access methods).
        '''

        pass

    def process(self, geocoder):
        '''
        Process any already-downloaded incidents.

        This will iterate over all downloaded incidents and attempt to ensure
        that they've been correctly converted into a CrimeDB incident. This may
        involve geocoding, filtering out of invalid incidents, and other work.
        This process should be interruptable / restartable. In particular, some
        geocoders are flakey so we should be able to run-execute the process()
        method multiple times to complete geocoding of incidents that dind't
        complete previously.
        '''

        pass

    def crimes(self):
        '''
        Iterator that yields crimedb.core.Crime objects.
        '''

        pass

    def _cache_dir(self):
        '''
        Return the directory to be used for caching raw files. Creates it if
        necessary.
        '''

        cache_dir = os.path.join(self.work_dir, 'raw')
        os.makedirs(cache_dir, exist_ok=True)

        return cache_dir

    def _intermediate_dir(self):
        '''
        Return the directory to be used for storing intermediate files. Creates
        it if necessary.
        '''

        int_dir = os.path.join(self.work_dir, 'intermediate')
        os.makedirs(int_dir, exist_ok=True)

        return int_dir
