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
Utilities for working with OSM XML dumps.
'''

import collections
import contextlib
from functools import partial
import logging
import lxml.etree
import shapely.geometry
import shapely.ops


class OSMParserCallbacks:
    Node = collections.namedtuple('Node', ['id', 'lon', 'lat', 'tags'])
    Way = collections.namedtuple('Way', ['id', 'nids', 'tags'])
    Relation = collections.namedtuple('Relation', ['id', 'wids', 'tags'])

    def __init__(self, nids=set(), wids=set(), rids=set()):
        self.nodes = {}
        self.ways = {}
        self.relations = {}

        self.__nids = set(nids)
        self.__wids = set(wids)
        self.__rids = set(rids)
        self._tag_stack = []
        self._id_stack = []

    def start(self, tag, attrib):
        tid = int(attrib.get('id', -1))

        if tag == 'node':
            self._id_stack.append(tid)
            if tid in self.__nids:
                self.nodes[tid] = OSMParserCallbacks.Node(
                        id=tid,
                        lon=float(attrib['lon']),
                        lat=float(attrib['lat']),
                        tags={})
        elif tag == 'way':
            self._id_stack.append(tid)
            if tid in self.__wids:
                self.ways[tid] = OSMParserCallbacks.Way(
                        id=tid, nids=[], tags={})
        elif tag == 'relation':
            self._id_stack.append(tid)
            if tid in self.__rids:
                self.relations[tid] = OSMParserCallbacks.Relation(
                        id=tid, wids=[], tags={})
        elif tag == 'nd' and \
                self._tag_stack[-1] == 'way' and \
                self._id_stack[-1] in self.__wids:
            self.ways[self._id_stack[-1]].nids.append(
                    int(attrib['ref']))
        elif tag == 'member' and \
                attrib['type'] == 'way' and \
                self._tag_stack[-1] == 'relation' and \
                self._id_stack[-1] in self.__rids:
            self.relations[self._id_stack[-1]].wids.append(
                    int(attrib['ref']))
        elif tag == 'tag':
            last_tag = self._tag_stack[-1]
            last_id = self._id_stack[-1]
            if last_tag == 'node' and last_id in self.__nids:
                self.nodes[last_id].tags[attrib['k']] = attrib['v']
            elif last_tag == 'way' and last_id in self.__wids:
                self.ways[last_id].tags[attrib['k']] = attrib['v']
            elif last_tag == 'relation' and last_id in self.__rids:
                self.relations[last_id].tags[attrib['k']] = attrib['v']

        self._tag_stack.append(tag)

    def end(self, tag):
        self._tag_stack.pop()

        if tag in set(['node', 'way', 'relation']):
            self._id_stack.pop()

    def data(self, data):
        pass

    def comment(self, text):
        pass

    def close(self):
        pass


def parse_osm_file_raw(f, rids=[], wids=[], nids=[]):
    '''
    Parse the given OSM XML file and return a (relations, ways, nodes) tuple.
    Each element of the tuple is a list of objects of the appropriate type: one
    of the OSMParserCallbavck.{Node, Way, Relation} classes.
    '''

    opc = OSMParserCallbacks(rids=rids, wids=wids, nids=nids)
    with contextlib.closing(lxml.etree.XMLParser(target=opc)) as xp:
        while True:
            d = f.read(1024)
            if not d:
                break
            xp.feed(d)

    return opc.relations, opc.ways, opc.nodes

def parse_osm_file(f, rids=set(), wids=set(), nids=set()):
    '''
    Parse the given OSM file and return a tuple of (relations, ways, nodes).

    Each element in this tuple is a dictionary mapping the entity's ID to a
    shapely.geometry object instance describing it: Polygons for relations,
    LineStrings for ways, and Points for nodes.
    '''

    pos = f.tell()

    # Look up relations
    logging.debug('looking for rids={}'.format(rids))
    relations = parse_osm_file_raw(f, rids=rids)[0]
    logging.info('matched {} relations'.format(len(relations)))

    # Grab wids from the relation and look up ways
    wids_needed = set(wids)
    for r in relations.values():
        wids_needed |= set(r.wids)
    logging.debug('looking for wids={}'.format(wids_needed))
    f.seek(pos)
    ways = parse_osm_file_raw(f, wids=wids_needed)[1]
    logging.info('matched {} ways'.format(len(ways)))

    # Grab nids from the ways and look up nodes
    nids_needed = set(nids)
    for w in ways.values():
        nids_needed |= set(w.nids)
    logging.debug('looking for nids={}'.format(nids_needed))
    f.seek(pos)
    nodes = parse_osm_file_raw(f, nids=nids_needed)[2]
    logging.info('matched {} nodes'.format(len(nodes)))

    # Now that we have the OSM nodes for each of the objects that we care about,
    # convert them into shapely.geometry objects
    def osm_node_to_shapely(n):
        val = {'osm': n.tags}
        val['shape'] = shapely.geometry.Point(n.lon, n.lat)
        return (n.id, val)
    nodes = dict(map(osm_node_to_shapely, nodes.values()))

    def osm_way_to_shapely(w):
        val = {'osm': w.tags}
        val['shape'] = shapely.geometry.LineString(
                [(nodes[nid]['shape'].x, nodes[nid]['shape'].y)
                    for nid in w.nids])
        return (w.id, val)
    ways = dict(map(osm_way_to_shapely, ways.values()))

    def osm_relation_to_shapely(r):
        val = {'osm': r.tags}

        polys, dangles, cuts, invalids = shapely.ops.polygonize_full(
            [ways[wid]['shape'] for wid in r.wids])

        if len(polys) != 1 or len(dangles) != 0 or \
           len(cuts) != 0 or len(invalids) != 0:
            logging.debug(('failed to create polygon from relation {}: '
                           'polys={}, dangles={}, cuts={}, invalids={}').format(
                r.id, len(polys), len(dangles), len(cuts), len(invalids)))
            return (r.id, None)

        val['shape'] = polys[0]
        return (r.id, val)
    relations = dict(map(osm_relation_to_shapely, relations.values()))

    # Finally, filter out any entities other than those that were requested
    def is_needed(ids, item):
        k, v = item
        return k in ids
    relations = dict(filter(partial(is_needed, rids), relations.items()))
    ways = dict(filter(partial(is_needed, wids), ways.items()))
    nodes = dict(filter(partial(is_needed, nids), nodes.items()))

    return relations, ways, nodes
