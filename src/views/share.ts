// Shared from another app: which world the note goes to. One world that takes changes goes
// straight to its catch screen; several ask; none says how to get one.
import { h } from '../dom';
import * as db from '../db';
import { hasShared } from '../share';
import { go, topbar } from '../ui';
import { recordCanWrite } from '../world';

export async function shareView(): Promise<HTMLElement> {
  if (!hasShared()) {
    go('#/worlds', true);
    return h('main', { class: 'screen' });
  }
  const worlds = (await db.listWorlds()).filter(recordCanWrite).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (worlds.length === 1) {
    go(`#/w/${worlds[0].id}/capture`, true);
    return h('main', { class: 'screen' });
  }
  return h(
    'main',
    { class: 'screen', 'data-screen': 'share' },
    topbar('Catch this', '#/worlds'),
    worlds.length
      ? h(
          'div',
          { class: 'stack' },
          h('p', { class: 'dim', style: 'margin:0' }, 'Which world does it go to? It lands in Unsorted.'),
          ...worlds.map((w) =>
            h(
              'a',
              { class: 'choice', href: `#/w/${w.id}/capture` },
              h('b', null, w.name || 'Unnamed world'),
              h('span', null, w.kind === 'local' ? 'On this phone' : 'Online'),
            ),
          ),
        )
      : h(
          'div',
          { class: 'stack' },
          h('p', { class: 'empty' }, 'No world here takes changes yet. Start one on this phone, or sign in, then share again.'),
          h('a', { class: 'btn btn-primary', href: '#/new' }, 'Start a world on this phone'),
        ),
  );
}
