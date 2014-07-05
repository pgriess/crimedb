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
Utilities for CLI tools in CrimeDB.
'''

import argparse
import logging

__root_log_level = logging.ERROR
__logging_levels = {
        'DEBUG': logging.DEBUG,
        'INFO': logging.INFO,
        'WARN': logging.WARN,
        'ERROR': logging.ERROR,
        'CRITICAL': logging.CRITICAL,
        'FATAL': logging.FATAL
}

logging_argument_parser = argparse.ArgumentParser(add_help=False)
'''
An ArgumentParser instance that supports basic logging configuration.
'''

logging_argument_parser.add_argument(
        '-v', '--verbose', action='count', dest='verbosity', default=0,
        help=('increase global logging verbosity; can be used '
              'multiple times (default: {})'.format(
                logging.getLevelName(__root_log_level))))
logging_argument_parser.add_argument(
        '--module-verbosity', action='append', default=[],
        metavar='<module>=<level>',
        help=('set logging verbosity of <module> to <level>; valid levels '
              'are: ' + ', '.join(__logging_levels.keys())))


def process_logging_args(args):
    '''
    Process arguments belonging to logging_argument_parser.
    '''

    logging.basicConfig(
            level=__root_log_level - args.verbosity * 10,
            style='{',
            format='{asctime} {levelname} [{name}]: {message}')

    for mv in args.module_verbosity:
        name, level = mv.split('=')
        logging.getLogger(name).setLevel(__logging_levels[level])
