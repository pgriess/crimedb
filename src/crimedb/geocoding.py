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
# TODO:
#
#   - Figure out what's causing "This key is not authorized for this
#     service. If you do not have a key, you can obtain a free key by
#     registering at http://developer.mapquest.com." errors. This
#     seems to occur when some kind of rate limit has been exceeded? Or
#     maybe we hit a misconfigured server in the pool?

'''
Geocoding utilities.
'''

from functools import cmp_to_key
import io
from itertools import islice
import json
import logging
import shapely.geometry
import traceback
import urllib.error
import urllib.parse
import urllib.request


__LOGGER = logging.getLogger(__name__)


# Comparison function for MapQuest granularities.
#
# See http://open.mapquestapi.com/geocoding/geocodequality.html.
#
# XXX: Replace this with an object and implement __lt__ and __eq__
def __granularity_comparator(a, b):
    granularities = 'PLIBAZ'

    assert a[0] in granularities
    ga = granularities.index(a[0])

    assert b[0] in granularities
    gb = granularities.index(b[0])

    if ga != gb:
        return ga - gb

    return int(a[1]) - int(b[1])


# Geocode the given set of addresses.
def __geocode_batch(key, locations, shape=None):
    def __location_comparator(a, b):
        # XXX: Take confidence into account as well?
        return __granularity_comparator(
                a['geocodeQualityCode'],
                b['geocodeQualityCode'])

    query_params = [('key', key)]
    query_params += [('location', l) for l in locations]

    if shape:
        query_params += [
                ('boundingBox',
                 '{},{},{},{}'.format(
                        shape.bounds[3],
                        shape.bounds[0],
                        shape.bounds[1],
                        shape.bounds[2]))]

    url = 'http://open.mapquestapi.com/geocoding/v1/batch?' + \
        urllib.parse.urlencode(query_params)
    ro = json.load(io.TextIOWrapper(urllib.request.urlopen(url),
                                    encoding='utf-8',
                                    errors='replace'))

    if ro['info']['statuscode'] != 0:
        __LOGGER.warn('Geocoding failed with status %d; yielding empty results'.format(ro['info']['statuscode']))
        for _ in locations:
            yield None
            return

    assert len(ro['results']) == len(locations), \
            'Got {} results for {} locations'.format(len(ro['results']), len(locations))

    for loc, result in zip(locations, ro['results']):
        # XXX: The API doesn't guarantee that results are returned
        #      in the same order that they were requested. However,
        #      this seems to be the case in practice.
        assert result['providedLocation']['location'] == loc

        locs = result['locations']

        # Filter out any locations not within our shape (if specified)
        if shape:
            locs = [l for l in locs if
                    shape.contains(shapely.geometry.Point(
                        l['displayLatLng']['lng'],
                        l['displayLatLng']['lat']))]

        # No locations found within our shape
        if not locs:
            yield None
            continue

        # Pick the most specific location
        locs = sorted(result['locations'],
                      key=cmp_to_key(__location_comparator))

        yield {
            'type': 'Point',
            'coordinates': [
                locs[0]['displayLatLng']['lng'],
                locs[0]['displayLatLng']['lat'],
            ],
        }


def geocode_mapquest(key, locations, shape=None, batch_size=10, **kwargs):
    '''
    Geocode the given iterable of locations, returning an iterable of
    GeoJSON objects in the same order as the addresses requested
    addresses.

    If an address could not be resolved, None is indicated.
    '''

    loc_iter = iter(locations)
    while True:
        loc_slice = [l for l in islice(loc_iter, batch_size)]
        if not loc_slice:
            breae
        yield from __geocode_batch(key, loc_slice, shape)


def geocode_null(locations, **kwargs):
    '''
    A null geocoder that doesn't do any actual geocoding; just yields
    None for all locations.
    '''

    for l in locations:
        yield None
