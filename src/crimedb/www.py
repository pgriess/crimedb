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
Utilities for www.crimedb.org.
'''

from collections import defaultdict
from functools import partial
import logging
import math
import pprint
import shapely.geometry
import unittest

__LOGGER = logging.getLogger(__name__)


# From http://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
def slippy_tile_coordinates_from_point(lon, lat, zoom):
    '''
    Get the Slippy map (x, y) tile coordinates for a given (lon, lat) location
    at the given zoom level.
    '''

    n = 2.0 ** zoom

    xtile = int((lon + 180.0) / 360.0 * n)

    lat_rad = math.radians(lat)
    ytile = int((1.0 - math.log(math.tan(lat_rad) + (1 / math.cos(lat_rad))) / math.pi) / 2.0 * n)

    return (xtile, ytile)


# From http://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
def point_from_slippy_tile_coordinates(x, y, z):
    n = 2.0 ** z
    lon_deg = x / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    lat_deg = math.degrees(lat_rad)
    return lon_deg, lat_deg


def grid_from_crimes(crimes, zoom):
    '''
    Return a {x => {y => count}} dictionary grid for the given set of crimes at
    the given zoom level. Uses slippy_tile_coordinates_from_point() to determine
    grid location.
    '''

    assert zoom >= 0

    grid = defaultdict(partial(defaultdict, int))
    for c in crimes:
        lon, lat = c['geo']['coordinates']
        x, y = slippy_tile_coordinates_from_point(lon, lat, zoom)
        grid[x][y] += 1

    return grid


def grid_add(*grids):
    '''
    Return an {x => {y => count}} dictinoary by summing the counts for all the
    grids passed as arguments.
    '''

    grid = defaultdict(partial(defaultdict, int))
    for g in grids:
        for x, ycounts in g.items():
            for y, count in ycounts.items():
                grid[x][y] += count

    return grid


def zgrid_from_grid(grid, zoom, min_zoom):
    '''
    Return a {z => {x => {y => count}}} dictionary grid computed by rolling up
    the starting grid and zoom level until we him the minimum zoom.
    '''

    assert min_zoom < zoom
    assert min_zoom >= 0

    zgrid = defaultdict(partial(defaultdict, partial(defaultdict, int)))

    # Populate the initial zoom level
    #
    # XXX: Somehow without this we end up taking a reference to 'grid' rather
    #      than copying it. grid.copy() doesn't work either, for some reason.
    for x, ycounts in grid.items():
        for y, count in ycounts.items():
            zgrid[zoom][x][y] = count

    for z in range(zoom, min_zoom, -1):
        for x, ycounts in zgrid[z].items():
            for y, count in ycounts.items():
                zgrid[z - 1][int(x / 2)][int(y / 2)] += zgrid[z][x][y]

    return zgrid


def rzgrid_from_zgrid(zgrid, zoom_depth):
    '''
    Return a {z => {x => {y => {x => {y => count}}} grid.

    Each cell of the grid is an {x => {y => count}} grid itself of z +
    zoom_depth resolution. The idea is to allow fetching of a single file
    representing a slice of the grid.
    '''

    rzgrid = defaultdict(
            partial(defaultdict,
                partial(defaultdict,
                    partial(defaultdict,
                        partial(defaultdict, int)))))

    max_zoom = max(zgrid.keys()) - zoom_depth
    assert max_zoom >= 0

    for z in range(0, max_zoom + 1):
        __LOGGER.info('Computing rzgrid zoom={}'.format(z))
        for x, ycounts in zgrid[z].items():
            for y, _ in zgrid[z][x].items():

                p = 2 ** zoom_depth
                xx_min = x * p
                xx_max = (x + 1) * p - 1
                yy_min = y * p
                yy_max = (y + 1) * p - 1
                for xx, yycounts in zgrid[z + zoom_depth].items():
                    if xx < xx_min or xx > xx_max:
                        continue

                    for yy, yycount in yycounts.items():
                        if yy < yy_min or yy > yy_max:
                            continue

                        rzgrid[z][x][y][xx - xx_min][yy - yy_min] = yycount

    return rzgrid


def grid_pformat(grid):
    '''
    Return a string for pretty printing a grid.

    This is necessary because pprint.pformat() on a collections.defaultdict()
    is not particularly helpful. This renders things as an [x, y] grid.
    '''

    x_min = min(grid.keys())
    x_max = max(grid.keys())
    y_min = min(grid[x_min].keys())
    y_max = max(grid[x_min].keys())

    pretty = []
    for y in range(y_min, y_max + 1):
        pretty += [pprint.pformat([grid[x][y] for x in range(x_min, x_max + 1)])]

    return '\n'.join(pretty)


def rzgrid_to_geojson(rzgrid, x, y, zoom, zoom_depth):
    '''
    Return a GeoJSON object describing the squares at rzgrid[z][x][y].
    '''

    nw = point_from_slippy_tile_coordinates(x, y, zoom)
    se = point_from_slippy_tile_coordinates(x + 1, y + 1, zoom)
    lon_width = (se[0] - nw[0]) / (2 ** zoom_depth)
    lat_width = (se[1] - nw[1]) / (2 ** zoom_depth)

    gjos = []
    for xx in range(0, 2 ** zoom_depth):
        for yy in range(0, 2 ** zoom_depth):
            # Since we're iterating by x, y ranges not based on what's actually
            # in the dictionary, make sure that we don't generate cells of
            # count 0 un-necessarily
            if yy not in rzgrid[zoom][x][y][xx]:
                continue

            so = shapely.geometry.box(
                nw[0] + xx * lon_width,
                nw[1] + yy * lat_width,
                nw[0] + (xx + 1) * lon_width,
                nw[1] + (yy + 1) * lat_width)
            gjo = shapely.geometry.mapping(so)
            gjo['crime_count'] = rzgrid[zoom][x][y][xx][yy]
            gjos += [gjo]

    return gjos


class GridTests(unittest.TestCase):
    '''
    Tests for verifying grid operations.
    '''

    def test_grid_add(self):
        '''
        Verify the behavior of grid_add().
        '''

        grid = grid_add(GridTests._GRID1, GridTests._GRID2)
        self.assertEqual(4, len(grid))
        self.assertEqual(grid, GridTests._list_to_grid([
            [14, 10, 14, 35],
            [17, 31, 27, 24],
            [27, 7, 25, 1],
            [13, 6, 3, 8],
        ]))

    def test_zgrid_from_grid(self):
        '''
        Verify the behavior of zgrid_from_grid().
        '''

        zgrid = zgrid_from_grid(GridTests._GRID1, 2, 0)
        self.assertEqual(zgrid[2], GridTests._GRID1)
        self.assertEqual(
                zgrid[1],
                GridTests._list_to_grid([
                    [41, 39],
                    [24, 16]
                ])
        )
        self.assertEqual(zgrid[0], GridTests._list_to_grid([[120]]))

    def test_rzgrid_from_zgrid(self):
        '''
        Verify the behavior of rzgrid_from_zgrid().
        '''

        zgrid = zgrid_from_grid(GridTests._GRID1, 2, 0)
        rzgrid = rzgrid_from_zgrid(zgrid, 1)
        self.assertEqual(
                rzgrid[0][0][0],
                GridTests._list_to_grid([
                    [41, 39],
                    [24, 16]]))
        self.assertEqual(
                rzgrid[1][0][0],
                GridTests._list_to_grid([
                    [13, 5],
                    [4, 19]]))
        self.assertEqual(
                rzgrid[1][0][1],
                GridTests._list_to_grid([
                    [10, 6],
                    [6, 2]]))
        self.assertEqual(
                rzgrid[1][1][0],
                GridTests._list_to_grid([
                    [8, 19],
                    [8, 4]]))
        self.assertEqual(
                rzgrid[1][1][1],
                GridTests._list_to_grid([
                    [7, 1],
                    [0, 8]]))

    def _list_to_grid(l):
        grid = defaultdict(partial(defaultdict, int))

        for row in range(0, len(l)):
            for col in range(0, len(l[row])):
                grid[col][row] = l[row][col]

        return grid

    _GRID1 = _list_to_grid([
        [13, 5, 8, 19],
        [4, 19, 8, 4],
        [10, 6, 7, 1],
        [6, 2, 0, 8],
    ])

    _GRID2 = _list_to_grid([
        [1, 5, 6, 16],
        [13, 12, 19, 20],
        [17, 1, 18, 0],
        [7, 4, 3, 0],
    ])
