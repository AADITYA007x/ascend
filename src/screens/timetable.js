// Weekly class timetable: day tabs, the classes on that day, and the add/edit class sheet.
import { h, icon } from '../ui/dom.js';
import { topbar } from '../ui/layout.js';
import { field, textInput, timeInput, select, chips, showMessages, fab, emptyState } from '../ui/fields.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { state, reload, subjectById } from '../state.js';
import { saveSlot, deleteSlot, restore } from '../db/repo.js';
import { makeSlot } from '../model/factory.js';
import { validateSlot } from '../model/validate.js';
import { slotsForDay, overlappingIds, classMinutesOnDay, freeMinutesPerDay } from '../model/timetable.js';
import { WEEKDAYS, WEEKDAYS_SHORT, formatMinutes, toMinutes, fromMinutes, todayYMD, weekdayMon0 } from '../model/time.js';
import { rerender } from '../router.js';

// Awake window used for the "free time" preview. Milestone 2 will make this a setting.
const DAY_START = '07:00';
const DAY_END = '23:00';

let selectedDay = weekdayMon0(todayYMD());

export function renderTimetable() {
  const overlaps = overlappingIds(state.slots);
  const daySlots = slotsForDay(state.slots, selectedDay);
  const free = freeMinutesPerDay(state.slots, DAY_START, DAY_END)[selectedDay];
  const classMin = classMinutesOnDay(state.slots, selectedDay);

  const tabs = h(
    'div',
    { class: 'day-tabs', role: 'tablist', 'aria-label': 'Day of the week' },
    WEEKDAYS_SHORT.map((d, i) => {
      const count = state.slots.filter((s) => s.day === i).length;
      return h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: `day-tab${i === selectedDay ? ' active' : ''}`,
          'aria-selected': i === selectedDay ? 'true' : 'false',
          'aria-label': `${WEEKDAYS[i]}, ${count} class${count === 1 ? '' : 'es'}`,
          onclick: () => {
            selectedDay = i;
            rerender();
          },
        },
        h('span', {}, d),
        h('span', { class: 'day-count', 'aria-hidden': 'true' }, count ? String(count) : '·'),
      );
    }),
  );

  const summary = h(
    'p',
    { class: 'day-summary muted' },
    classMin
      ? `${formatMinutes(classMin)} of class · about ${formatMinutes(free)} free between ${DAY_START} and ${DAY_END}`
      : `No classes. About ${formatMinutes(free)} free between ${DAY_START} and ${DAY_END}`,
  );

  const listEl = daySlots.length
    ? h(
        'ul',
        { class: 'cards slots' },
        daySlots.map((s) => {
          const subject = subjectById(s.subjectId);
          const name = subject?.name || s.label || 'Class';
          const clash = overlaps.has(s.id);
          return h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                class: `card card-link slot-card${clash ? ' clash' : ''}`,
                style: { '--subject': subject?.color ?? 'var(--muted)' },
                onclick: () => openSlotSheet(s),
              },
              h('span', { class: 'slot-time' }, h('span', {}, s.start), h('span', { class: 'muted' }, s.end)),
              h(
                'span',
                { class: 'card-main' },
                h('span', { class: 'card-heading' }, name),
                subject && s.label ? h('span', { class: 'muted small' }, s.label) : null,
                clash ? h('span', { class: 'clash-note small' }, 'Overlaps another class') : null,
              ),
            ),
          );
        }),
      )
    : emptyState(
        `Nothing on ${WEEKDAYS[selectedDay]}`,
        'Add your classes, labs and tutorials so Ascend only plans study in your free time.',
      );

  const total = state.slots.length;
  return {
    title: 'Timetable',
    top: topbar('Timetable', { subtitle: total ? `${total} class${total === 1 ? '' : 'es'} a week` : 'Your weekly classes' }),
    body: [tabs, summary, listEl, fab('Add class', () => openSlotSheet(null))],
  };
}

function openSlotSheet(existing) {
  const s = existing ?? makeSlot({ semesterId: state.semester.id, day: selectedDay, subjectId: state.subjects[0]?.id ?? '' });
  const subjectOptions = [
    ...state.subjects.map((x) => ({ value: x.id, label: x.name })),
    { value: '', label: 'Other (not a subject)' },
  ];

  const startInput = timeInput('start', s.start);
  const endInput = timeInput('end', s.end);
  // Keep the class length when the start time moves.
  let duration = Math.max(15, (toMinutes(s.end) ?? 0) - (toMinutes(s.start) ?? 0)) || 60;
  startInput.addEventListener('change', () => {
    const st = toMinutes(startInput.value);
    if (st !== null) endInput.value = fromMinutes(Math.min(st + duration, 23 * 60 + 59));
  });
  endInput.addEventListener('change', () => {
    const st = toMinutes(startInput.value);
    const en = toMinutes(endInput.value);
    if (st !== null && en !== null && en > st) duration = en - st;
  });

  const body = h(
    'div',
    {},
    field('subjectId', 'Subject', select('subjectId', subjectOptions, s.subjectId)),
    field('label', 'Type or name (optional)', textInput('label', s.label ?? '', { placeholder: 'e.g. Lecture, Lab, Tutorial', maxlength: 40 })),
    h(
      'div',
      { class: 'field', 'data-field': 'day' },
      h('span', { class: 'field-label' }, existing ? 'Day' : 'Days'),
      chips(
        'day',
        WEEKDAYS_SHORT.map((d, i) => ({ value: i, label: d })),
        s.day,
        { multiple: !existing, label: 'Days' },
      ),
      existing ? null : h('p', { class: 'field-hint' }, 'Pick every day this class happens at the same time.'),
      h('p', { class: 'field-msg' }),
    ),
    h('div', { class: 'row-2' }, field('start', 'Starts', startInput), field('end', 'Ends', endInput)),
  );

  const extra = existing
    ? [
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-quiet danger-text',
            onclick: async () => {
              sheet.close();
              await sheet.closed;
              const snapshot = await deleteSlot(s.id);
              await reload();
              rerender();
              toast('Class removed', {
                actionLabel: 'Undo',
                onAction: async () => {
                  await restore(snapshot);
                  await reload();
                  rerender();
                },
              });
            },
          },
          icon('trash', 18),
          'Delete',
        ),
      ]
    : [];

  const sheet = openSheet({
    title: existing ? 'Edit class' : 'New class',
    body,
    extraActions: extra,
    onSubmit: async (form) => {
      const fd = new FormData(form);
      const days = fd.getAll('day').map(Number);
      const base = {
        subjectId: String(fd.get('subjectId') ?? ''),
        label: String(fd.get('label') ?? '').trim(),
        start: String(fd.get('start') ?? ''),
        end: String(fd.get('end') ?? ''),
      };
      const records = existing
        ? [{ ...s, ...base, day: days[0] }]
        : days.map((day) => makeSlot({ ...base, semesterId: s.semesterId, day }));
      const v = records.length ? validateSlot(records[0]) : validateSlot({ ...base, day: -1 });
      if (!records.length) v.errors.day = 'Pick at least one day.';
      v.ok = Object.keys(v.errors).length === 0;
      showMessages(form, v);
      if (!v.ok) return false;

      for (const r of records) await saveSlot(r);
      await reload();
      if (!existing && !records.some((r) => r.day === selectedDay)) selectedDay = records[0].day;
      rerender();
      const clash = records.some((r) => overlappingIds(state.slots).has(r.id));
      toast(
        clash
          ? 'Saved. It overlaps another class. Check it when you have a moment.'
          : existing
            ? 'Class saved'
            : `Added on ${records.length} day${records.length === 1 ? '' : 's'}`,
      );
    },
  });
}
