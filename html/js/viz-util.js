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

        /**
         * Given a GeoJSON object, return a location query to use for fetching
         * its data from CrimeDB.
         */
        geoJSONToCrimeDBLocation: function(gj) {
            var bbox = geoJSONBoundingBox(gj);

            return '[' +
                bbox[2] + ',' + bbox[0] + ':' +
                bbox[3] + ',' + bbox[1] +
            ']';
        },

        /**
         * Given a GeoJSON polygon, bucketize the given crime data into a grid and
         * return the grid.
         *
         * Each grid element is an array of CrimeDB objects corresponding to
         * that location.
         */
        getCrimeGridFromData: function(gj, crimeData, gridSize) {
            var bbox = geoJSONBoundingBox(gj);
            var lonSize = Math.ceil((bbox[1] - bbox[0]) / gridSize);
            var latSize = Math.ceil((bbox[3] - bbox[2]) / gridSize);

            /* Initialize an empty grid */
            var dataGrid = new Array(lonSize);
            for (var i = 0; i < lonSize + 1; ++i) {
                dataGrid[i] = new Array(latSize);
                for (var ii = 0; ii < latSize + 1; ++ii) {
                    dataGrid[i][ii] = 0;
                }
            }

            /* Filter out crimes that did not occur within our boundaries */
            crimeData = crimeData.filter(function(c) {
                return 'geo' in c &&
                       c.geo.coordinates[0] >= bbox[0] &&
                       c.geo.coordinates[0] <= bbox[1] &&
                       c.geo.coordinates[1] >= bbox[2] &&
                       c.geo.coordinates[1] <= bbox[3];
            });

            /* Fill crime data into the grid */
            var lonBegin = Math.floor(bbox[0] / gridSize) * gridSize;
            var latBegin = Math.floor(bbox[2] / gridSize) * gridSize;
            crimeData.forEach(function(c) {
                var lo = Math.floor((c.geo.coordinates[0] - lonBegin) / gridSize);
                lo = Math.min(Math.max(lo, 0), lonSize);
                var la = Math.floor((c.geo.coordinates[1] - latBegin) / gridSize);
                la = Math.min(Math.max(la, 0), latSize);
                ++dataGrid[lo][la];
            });

            return dataGrid;
        },

        /**
         * Get a GeoJSON object from the given grid of crime data.
         */
        getGeoJSONFromCrimeGrid: function(gj, crimeGrid, gridSize) {
            var bbox = geoJSONBoundingBox(gj);
            var westEdge = Math.floor(bbox[0] / gridSize) * gridSize;
            var southEdge = Math.floor(bbox[2] / gridSize) * gridSize;

            return crimeGrid.reduce(
                function(gj, crimeCol, x) {
                    return gj.concat(
                        crimeCol.reduce(
                            function(gj, crime, y) {
                                return gj.concat({
                                    type: 'Feature',
                                    properties: {
                                        crimeCount: crimeGrid[x][y],
                                    },
                                    geometry: {
                                        type: 'Polygon',
                                        coordinates: [[
                                            [westEdge + x * gridSize, southEdge + y * gridSize],
                                            [westEdge + (x + 1) * gridSize, southEdge + y * gridSize],
                                            [westEdge + (x + 1) * gridSize, southEdge + (y + 1) * gridSize],
                                            [westEdge + x * gridSize, southEdge + (y + 1) * gridSize],
                                            [westEdge + x * gridSize, southEdge + y * gridSize],
                                        ]],
                                    }
                                });
                            },
                            []
                        )
                    );
                },
                []
            );
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
