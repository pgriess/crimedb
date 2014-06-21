requirejs.config({
    baseUrl: '../js',
});

requirejs(
    ['jquery', 'jquery-ui', 'leaflet', 'viz-util'],
    function(jquery, jqueryUi, L, vizUtil) {
        var GRID_SIZE = 0.002;
        // http://www.colorbrewer2.org/
        var GRID_COLORS = [
            '#3288BD',
            '#66C2A5',
            '#ABDDA4',
            '#E6F598',
            '#FEE08B',
            '#FDAE61',
            '#F46D43',
            '#D53E4F',
        ];
        var GRID_PERCENTILES = [
            0.0,
            0.10,
            0.25,
            0.50,
            0.75,
            0.90,
            0.95,
            0.99,
            1.0
        ];
        var CITY_HALL = [38.627047, -90.199192];

        var currentLayers = [];
        var legendLayer = null;
        var currentBounds = null;

        /* TODO: Filter returned regions by map's viewable area */
        var getMetaData = function(map, cb) {
            jquery.getJSON('meta.json', cb);
        };

        var updateMap = function(map) {
            getMetaData(map, function(md) {
                var bounds = map.getBounds();

                // Map hasn't changed; nothing to do
                if (bounds.equals(currentBounds)) {
                    return;
                }

                currentBounds = bounds;

                jquery.getJSON(
                    '2013-01.json',
                    function (crimeData) {
                        currentLayers.forEach(function(l) {
                            map.removeLayer(l);
                        });

                        if (legendLayer) {
                            map.removeLayer(legendLayer);
                            jquery('.legend').remove();
                        }

                        var crimeDataGrid = vizUtil.getCrimeGridFromData(
                            vizUtil.leafletBoundsToGeoJSON(map.getBounds()),
                            crimeData.crimes,
                            GRID_SIZE
                        );
                        var crimeGeoJson = vizUtil.getGeoJSONFromCrimeGrid(
                            vizUtil.leafletBoundsToGeoJSON(map.getBounds()),
                            crimeDataGrid,
                            GRID_SIZE
                        );
                        var colorBuckets = vizUtil.computePercentiles(
                            crimeDataGrid.reduce(
                                function(acc, v) { return acc.concat(v); },
                                []
                            ),
                            GRID_PERCENTILES
                        );

                        var l = L.geoJson(crimeGeoJson, {
                            style: function (f) {
                                return {
                                    color: GRID_COLORS[
                                        vizUtil.bucketForValue(
                                            f.properties.crimeCount,
                                            colorBuckets
                                        )
                                    ],
                                    fillOpacity: 0.4,
                                    stroke: false
                                };
                            }
                        }).addTo(map);
                        currentLayers.push(l);

                        /* Add region line */
                        var l = L.geoJson(md.geo, {
                            style: function (f) {
                                return {
                                    fill: false,
                                    clickable: false,
                                };
                            }
                        }).addTo(map);
                        currentLayers.push(l);

                        legendLayer = L.control({position: 'bottomright'});
                        legendLayer.onAdd = function(map) {
                            var div = L.DomUtil.create('div', 'legend');
                            for (var i = colorBuckets.length - 1; i > 0; --i) {
                                var text = colorBuckets[i - 1] + ' - ' + colorBuckets[i];

                                div.innerHTML +=
                                    '<i class="swatch" ' +
                                        'style="background: ' +
                                        GRID_COLORS[i] +
                                        ';"></i>' + text + '<br/>';
                            }

                            return div;
                        };
                        legendLayer.addTo(map);
                    }
                );
            });
        };

        jquery(document).ready(function() {
            var map = L.map('map');

            map.on('load', function() { updateMap(map); })
                .on('viewreset', function() { updateMap(map); })
                .on('zoomend', function() { updateMap(map); })
                .on('moveend', function() { updateMap(map); })
                .on('resize', function() { updateMap(map); });

            /*
             * Add tile layer for Stamen Toner.
             *
             * Copied from http://maps.stamen.com/js/tile.stamen.js?v1.2.3
             * as it could not be used directly due use of RequireJS
             * (tile.stamen.js assumes that the 'L' global is available).
             */
            L.StamenTileLayer = L.TileLayer.extend({
                initialize: function(name) {
                    L.TileLayer.prototype.initialize.call(
                        this,
                        'http://{s}tile.stamen.com/toner-lite/{z}/{x}/{y}.png',
                        {
                            minZoom: 0,
                            maxZoom: 20,
                            subdomains: ['a.', 'b.', 'c.', 'd.'],
                            scheme: 'xyz',
                            attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, under <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a>. Data by <a href="http://openstreetmap.org">OpenStreetMap</a>, under <a href="http://creativecommons.org/licenses/by-sa/3.0">CC BY SA</a>.',
                        }
                    );
                }
            });
            map.addLayer(new L.StamenTileLayer('toner-lite'))
                .setView(CITY_HALL, 14);
        });
    }
);
