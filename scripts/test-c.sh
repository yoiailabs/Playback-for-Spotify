#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p test/c/bin
"${CC:-cc}" -std=c99 -O2 -g -Wall -Wextra -Werror -Wno-unused-parameter \
  -Itest/c/include test/c/marquee_test.c -o test/c/bin/marquee_test
test/c/bin/marquee_test
"${CC:-cc}" -std=c99 -O2 -g -Wall -Wextra -Werror \
  test/c/progress_test.c src/c/progress.c -o test/c/bin/progress_test
test/c/bin/progress_test
"${CC:-cc}" -std=c99 -O2 -g -Wall -Wextra -Werror \
  test/c/settings_test.c src/c/settings.c -o test/c/bin/settings_test
test/c/bin/settings_test
"${CC:-cc}" -std=c99 -O2 -g -Wall -Wextra -Werror \
  test/c/outbox_queue_test.c src/c/outbox_queue.c -o test/c/bin/outbox_queue_test
test/c/bin/outbox_queue_test
