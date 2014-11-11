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
Utilities for debugging.
'''

import json
import os.path
import pystache
import shapely.geometry
import subprocess
import tempfile

def view_shapely_objects(*sos):
    '''
    Render the given list of shapely.geometry objects in a web browser.
    '''

    gjos = [shapely.geometry.mapping(so) for so in sos]
    return view_geojson_objects(*gjos)


def view_geojson_objects(*gjos):
    '''
    Render the given list of GeoJSON objects in a web browser.
    '''

    # Figure out the bounding box that contains all objects
    bbox = None
    for gjo in gjos:
        so = shapely.geometry.shape(gjo)
        if bbox is None:
            bbox = so.bounds
            continue

        minx, miny, maxx, maxy = so.bounds
        bbox = min(minx, bbox[0]), \
                min(miny, bbox[1]), \
                max(maxx, bbox[2]), \
                max(maxy, bbox[3])

    bbox = shapely.geometry.box(*bbox)

    html_content = '''
<html>
    <head>
        <link rel="stylesheet" href="http://cdn.leafletjs.com/leaflet-0.7.3/leaflet.css"/>
        <link rel="stylesheet" href="http://ajax.googleapis.com/ajax/libs/jqueryui/1.11.0/themes/smoothness/jquery-ui.css" />

        <script src="http://cdn.leafletjs.com/leaflet-0.7.3/leaflet.js"></script>
        <script src="http://ajax.googleapis.com/ajax/libs/jquery/2.1.0/jquery.min.js"></script>
        <script src="http://ajax.googleapis.com/ajax/libs/jqueryui/1.11.0/jquery-ui.min.js"></script>
        <script src="http://maps.stamen.com/js/tile.stamen.js?v1.3.0"></script>

        <style type="text/css">
            #map {
                height: 90%;
            }
        </style>

        <script type="text/javascript">
            var COLORS = [
                'red',
                'orange',
                'yellow',
                'green',
                'blue',
                'purple',
            ];

            $(function() {
                var map = L.map('map');

                map.addLayer(new L.StamenTileLayer('toner'));

                var i = 0;
                {{#gjObjects}}
                    map.addLayer(
                        L.geoJson(
                            {{{gjo}}},
                            {
                                style: function() {
                                    return {
                                        color: COLORS[i++ % COLORS.length]
                                    };
                                }
                            }
                        )
                    );
                {{/gjObjects}}

                map.setView([{{center.lat}}, {{center.lon}}], {{zoom}});
            });
        </script>
    </head>

    <body>
        <div id="map"/>
    </body>
</html>
    '''

    with tempfile.TemporaryDirectory() as temp_dir:
        view_path = os.path.join(temp_dir, 'view.html')

        context = {
            'gjObjects': [{'gjo': json.dumps(gjo)} for gjo in gjos],
            'center': {'lon': bbox.centroid.x, 'lat': bbox.centroid.y},
            'zoom': 10,
        }
        with open(view_path, 'wt', encoding='utf-8') as f:
            f.write(pystache.render(html_content, context))

        rc = subprocess.call(['open', view_path])
        if rc:
            print('view failed with exit code {}'.format(rc), file=sys.stderr)
            sys.exit(rc)

        input('Press <enter> to exit application\n')
