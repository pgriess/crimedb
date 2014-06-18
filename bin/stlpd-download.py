#!/bin/env python3.3
#
# Download STLPD crime data and write YYYY-MM.json and meta.json files
# to a directory.
#
# NOTES:
#
#   - The initial meta.json file was constructed by running hapi/sv/run and
#     hitting /regions, then hand-editing the results. We should really port
#     the OSM code to Python and do the missouri-latest.osm manipulation
#     directly.

import argparse
from collections import defaultdict
import crimedb.core
import crimedb.stlpd
import datetime
import json
import logging
import os.path
import pytz
import sys
import time

utc_tz = pytz.timezone('UTC')

ap = argparse.ArgumentParser(
        description='''
Download St. Louis Police Department crime data from
http://www.slmpd.org/Crimereports.shtml and transform it into CrimeDB
JSON files.
''')
ap.add_argument('--dir', default='.',
                help='output directory (default: %(default)s)')
ap.add_argument('-v', action='count', dest='verbosity', default=0,
                help='increase logging verbosity; can be used multiple times')

args = ap.parse_args()

logging.basicConfig(
        level=logging.ERROR - args.verbosity * 10,
        style='{',
        format='{prog}: {{message}}'.format(
                prog=os.path.basename(sys.argv[0])))

now = utc_tz.localize(
        datetime.datetime.fromtimestamp(
                time.mktime(time.gmtime())))

crimes_by_month = defaultdict(list)
num_crimes = 0
for c in crimedb.stlpd.crimes():
    crimes_by_month[c.time.strftime('%Y-%m')] += [c]
    num_crimes += 1
    if num_crimes > 100:
        break

for month, crimes in crimes_by_month.items():
    with open(os.path.join(args.dir, month + '.json'), 'wt') as mf:
        json.dump({
                'update_time': now.strftime(
                        crimedb.core.RFC3999_STRFTIME_FORMAT),
                'crimes': [crimedb.core.crime2json_obj(c) for c in crimes],
            },
            mf
        )

with open(os.path.join(args.dir, 'meta.json'), 'rt') as mf:
    meta_obj = json.load(mf)

meta_obj['update_time'] = now.strftime(crimedb.core.RFC3999_STRFTIME_FORMAT)

crime_months = sorted(crimes_by_month.keys())
meta_obj['date_range'] = [
    sorted(crimes_by_month[crime_months[0]],
           key=lambda c: c.time)[0].time.strftime(crimedb.core.RFC3999_STRFTIME_FORMAT),
    sorted(crimes_by_month[crime_months[-1]],
           key=lambda c: c.time)[-1].time.strftime(crimedb.core.RFC3999_STRFTIME_FORMAT),
]

with open(os.path.join(args.dir, 'meta.json'), 'wt') as mf:
    json.dump(meta_obj, mf)
