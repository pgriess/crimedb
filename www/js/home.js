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
/*
 * JavaScript for the CrimeDB homepage.
 */

requirejs.config({
    baseUrl: '/js',
    paths: {
        async: 'lib/requirejs/async',
    },
});

requirejs(
    ['leaflet', 'jquery', 'gmaps', 'crimedb-leaflet', 'stamen-leaflet'],
    function(L, $, gmaps) {
        var geocoder = new gmaps.Geocoder();

        var goToAddress = function(map, address) {
            geocoder.geocode({address: address}, function(results, status) {
                if (status === gmaps.GeocoderStatus.OK) {
                    var loc = results[0].geometry.location;
                    map.setView([loc.lat(), loc.lng()], 14);
                }
            });
        };

        $(document).ready(function() {
            var map = L.map('map');

            map.addLayer(new L.StamenTileLayer('toner-lite'))
                .addLayer(new L.CrimeDBLayer())
                .setView([38.638641, -90.283651], 14);

            $('#gobutton').click(function() {
                goToAddress(map, $('#address').val());
            });
        });
    }
);
