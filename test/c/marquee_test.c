#include <assert.h>
#include <pebble.h>

// Include the unmodified implementation to exercise static tick/overflow math.
#include "../../src/c/marquee.c"

static AppTimer timer;
static unsigned registrations, cancellations, redraws;
static AppTimerCallback scheduled_callback;
static void *scheduled_data;

AppTimer *app_timer_register(uint32_t ms, AppTimerCallback callback, void *data) {
  assert(ms == TICK_MS);
  registrations++;
  scheduled_callback = callback;
  scheduled_data = data;
  return &timer;
}
void app_timer_cancel(AppTimer *value) { assert(value == &timer); cancellations++; }
static void redraw(void *ctx) { assert(ctx == &redraws); redraws++; }
static void set(Marquee *m, const char *text, int width) {
  marquee_set(m, text, "test-font", width, redraw, &redraws);
}
static void tick(void) { assert(scheduled_callback); scheduled_callback(scheduled_data); }
static void reset(void) {
  while (s_active_count) marquee_unregister(s_active[0]);
  registrations = cancellations = redraws = 0;
  scheduled_callback = NULL;
}

static void empty_and_invalid_layout(void) {
  Marquee m = {0};
  marquee_set(NULL, "ignored", "test-font", 10, NULL, NULL);
  set(&m, NULL, 10);
  assert(!m.overflows && !m.registered && m.text_width == 0);
  set(&m, "long text", 0);
  assert(!m.overflows && !m.registered);
  marquee_set(&m, "long text", NULL, 10, NULL, NULL);
  assert(!m.overflows && registrations == 0);
}
static void exact_fit_does_not_scroll(void) {
  Marquee m = {0};
  set(&m, "four", 20);
  assert(m.text_width == 20 && m.max_offset == 0);
  assert(!m.overflows && !m.registered && registrations == 0);
}
static void overflow_registers_once(void) {
  Marquee m = {0};
  set(&m, "four", 9);
  assert(m.overflows && m.max_offset == 11 && m.px_offset == 0);
  assert(m.pause == END_PAUSE_TICKS && m.registered && registrations == 1);
  register_marquee(&m);
  assert(s_active_count == 1 && registrations == 1);
  marquee_unregister(&m);
}
static void initial_pause_then_step(void) {
  Marquee m = {0};
  set(&m, "four", 9);
  for (int i = 0; i < END_PAUSE_TICKS; i++) tick();
  assert(m.px_offset == 0 && redraws == 0);
  tick();
  assert(m.px_offset == STEP_PX && redraws == 1);
  marquee_unregister(&m);
}
static void clamps_odd_endpoint_then_wraps(void) {
  Marquee m = {0};
  set(&m, "four", 9);
  m.pause = 0;
  for (int i = 0; i < 6; i++) tick();
  assert(m.px_offset == 11 && m.pause == END_PAUSE_TICKS && redraws == 6);
  for (int i = 0; i < END_PAUSE_TICKS; i++) tick();
  assert(m.px_offset == 11 && redraws == 6);
  tick();
  assert(m.px_offset == 0 && m.pause == END_PAUSE_TICKS && redraws == 7);
  marquee_unregister(&m);
}
static void unchanged_poll_preserves_position(void) {
  Marquee m = {0};
  set(&m, "four", 9);
  m.px_offset = 4; m.pause = 7;
  set(&m, "four", 9);
  assert(m.px_offset == 4 && m.pause == 7 && registrations == 1);
  marquee_unregister(&m);
}
static void changed_layout_resets_position(void) {
  Marquee m = {0};
  set(&m, "four", 9);
  m.px_offset = 4; m.pause = 0;
  set(&m, "five!", 10);
  assert(m.px_offset == 0 && m.pause == END_PAUSE_TICKS && m.max_offset == 15);
  set(&m, "ok", 10);
  assert(!m.registered && cancellations == 1 && s_timer == NULL);
}
static void truncation_is_terminated(void) {
  Marquee m = {0};
  char text[200]; memset(text, 'a', sizeof(text)); text[199] = '\0';
  set(&m, text, 10);
  assert(m.text_len == 95 && m.text[95] == '\0' && m.text_width == 475);
  marquee_unregister(&m);
}
static void registry_capacity_and_compaction(void) {
  Marquee items[MAX_MARQUEES + 1] = {0};
  for (int i = 0; i <= MAX_MARQUEES; i++) set(&items[i], "long text", 10);
  assert(s_active_count == MAX_MARQUEES && !items[MAX_MARQUEES].registered);
  assert(registrations == 1);
  marquee_unregister(&items[3]);
  assert(s_active[3] == &items[4] && s_active_count == MAX_MARQUEES - 1);
  assert(cancellations == 0);
  register_marquee(&items[MAX_MARQUEES]);
  assert(items[MAX_MARQUEES].registered && s_active_count == MAX_MARQUEES);
  for (int i = 0; i <= MAX_MARQUEES; i++) marquee_unregister(&items[i]);
  assert(s_active_count == 0 && cancellations == 1);
  marquee_unregister(NULL);
  marquee_unregister(&items[0]);
  assert(cancellations == 1);
}
static void shared_timer_updates_independent_offsets(void) {
  Marquee a = {0}, b = {0};
  set(&a, "four", 19); set(&b, "four", 10);
  a.pause = b.pause = 0;
  tick();
  assert(a.px_offset == 1 && b.px_offset == 2 && redraws == 2);
  assert(registrations == 2); // one initial schedule, one after the tick
  marquee_unregister(&a); marquee_unregister(&b);
}
static void layer_stop_and_destroy_unregister(void) {
  MarqueeLayer *ml = marquee_layer_create(GRect(0, 0, 10, 20));
  assert(ml && marquee_layer_get_layer(ml));
  marquee_layer_set_font(ml, "test-font");
  marquee_layer_set_text(ml, "long text");
  assert(ml->m.registered);
  ml->m.px_offset = 4;
  marquee_layer_stop(ml);
  assert(!ml->m.registered && ml->m.px_offset == 0 && cancellations == 1);
  marquee_layer_set_text(ml, "different long text");
  marquee_layer_destroy(ml);
  assert(s_active_count == 0 && cancellations == 2);
  assert(marquee_layer_get_layer(NULL) == NULL);
  marquee_layer_destroy(NULL);
}
static void characterization_font_change_keeps_stale_width(void) {
  MarqueeLayer *ml = marquee_layer_create(GRect(0, 0, 10, 20));
  marquee_layer_set_text(ml, "long text"); // font initially NULL
  assert(ml->m.text_width == 0);
  marquee_layer_set_font(ml, "test-font");
  // Existing bug: set_font assigns font before marquee_set's equality guard.
  assert(ml->m.text_width == 0 && !ml->m.registered);
  marquee_layer_destroy(ml);
}

#define RUN(fn) do { reset(); fn(); puts("ok - " #fn); count++; } while (0)
int main(void) {
  unsigned count = 0;
  RUN(empty_and_invalid_layout);
  RUN(exact_fit_does_not_scroll);
  RUN(overflow_registers_once);
  RUN(initial_pause_then_step);
  RUN(clamps_odd_endpoint_then_wraps);
  RUN(unchanged_poll_preserves_position);
  RUN(changed_layout_resets_position);
  RUN(truncation_is_terminated);
  RUN(registry_capacity_and_compaction);
  RUN(shared_timer_updates_independent_offsets);
  RUN(layer_stop_and_destroy_unregister);
  RUN(characterization_font_change_keeps_stale_width);
  reset();
  printf("%u C tests passed\n", count);
  return 0;
}
