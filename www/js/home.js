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

requirejs.config({
    baseUrl: '/js',
});

requirejs(
    ['leaflet', 'crimedb-leaflet', 'stamen-leaflet'],
    function(L) {
        var onLoad = function(e) {
            var map = L.map('map');

            map.addLayer(new L.StamenTileLayer('toner-lite'))
                .addLayer(new L.CrimeDBLayer())
                .setView([38.638641, -90.283651], 14);
        };

        window.addEventListener('load', onLoad, false);
    }
);
