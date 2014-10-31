/*!
 * Copyright 2014 Peter Griess
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

define(function() {
    /**
     * Return a bounding box from the given GeoJSON object.
     *
     * The returned box is in the same format as the GeoJSON 'bbox'
     * attribute: an array of 4 elements: [minLon, maxLon, minLat, maxLat].
     * If the GeoJSON object has a 'bbox' property, that is simply returned
     * directly; otherwise, it is calculated.
     */
    var geoJSONBoundingBox = function(gj) {
        if ('bbox' in gj) {
            return gj.bbox;
        }

        if (gj.type != 'Polygon') {
            throw 'Only Polygon types supported now';
        }

        var lons = gj.coordinates[0].map(function(c) { return c[0]; });
        var lats = gj.coordinates[0].map(function(c) { return c[1]; });

        return [
            Math.min.apply(null, lons), Math.max.apply(null, lons),
            Math.min.apply(null, lats), Math.max.apply(null, lats)
        ];
    };

    return {
        /**
         * Compute the requested percentiles (which must be in the range [0,
         * 1.0]) for the given array of values, returning them in an array.
         */
        computePercentiles: function(values, percentiles) {
            var sortedValues = values.slice(0);
            sortedValues.sort(function(a, b) { return a - b; });

            return percentiles.map(function(p) {
                return sortedValues[Math.floor((sortedValues.length - 1) * p)];
            });
        },

        /**
         * Given a sorted array representing bucket boundaries,
         * return the index of the bucket to which the given value
         * belongs.
         */
        bucketForValue: function(value, percentileBuckets) {
            for (var i = 0; i < percentileBuckets.length - 1; ++i) {
                if (percentileBuckets[i] > percentileBuckets[i + 1]) {
                    throw 'Percentile buckets are not sorted!';
                }

                if (value >= percentileBuckets[i] &&
                    value <= percentileBuckets[i + 1]) {
                    return i;
                }
            }

            throw 'Could not find bucket for value!';
        },

        /**
         * Turn a base URL and a dictionary of query parameters into a URL.
         */
        buildURL: function(base, params) {
            var url = base;
            Object.keys(params).forEach(function(pn, index) {
                url += (index === 0) ? '?' : '&';
                url += pn + '=' + params[pn];
            });

            return url;
        },

        geoJSONIntersection: function(gj1, gj2) {
            if (gj1.type == 'Feature') {
                gj1 = gj1.geometry;
            }
            if (gj2.type == 'Feature') {
                gj2 = gj2.geometry;
            }

            if (gj1.type !== 'Polygon' || gj2.type !== 'Polygon') {
                throw 'GeoJSON objects must be Polygons';
            }

            var poly1 = new gpcas.geometry.PolyDefault(gj1.coordinates[0]);
            var poly2 = new gpcas.geometry.PolyDefault(gj2.coordinates[0]);

            return undefined;
        },

        geoJSONBoundingBox: geoJSONBoundingBox,

        /* Convert a Leaflet Bounds into a GeoJSON polygon */
        leafletBoundsToGeoJSON: function(bounds) {
            return {
                type: 'Polygon',
                bbox: [
                    bounds.getWest(), bounds.getEast(),
                    bounds.getSouth(), bounds.getNorth(),
                ],
                coordinates: [[
                    [bounds.getWest(), bounds.getNorth()],
                    [bounds.getEast(), bounds.getNorth()],
                    [bounds.getEast(), bounds.getSouth()],
                    [bounds.getWest(), bounds.getSouth()],
                    [bounds.getWest(), bounds.getNorth()],
                ]],
            };
        },
    };
});
