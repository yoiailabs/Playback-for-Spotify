#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p test/c/bin
"${CC:-cc}" -std=c99 -O2 -g -Wall -Wextra -Werror -Wno-unused-parameter \
  -Itest/c/include test/c/marquee_test.c -o test/c/bin/marquee_test
test/c/bin/marquee_test
