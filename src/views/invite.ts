// Invite someone: the owner makes an invite link on the phone (keel C1, SDK 4.24) and sends it with
// the phone's share sheet, copies it, or shows its QR code across the table. The link is shown once:
// keel keeps only a hash, and Lantern keeps nothing. Seeing and taking back links is the website's.
// "A player" is keel's no-account player link (#416, the Captain's yes on the sharing floor, h50
// #7610), reading as a Character the owner picks or a new one; an account guest is one choice down.
// Atlas's half: `tools/atlas/src/ui/invite-modal.ts`. The choices and words match.
import * as db from '../db';
import { h } from '../dom';
import { errorText, sheet, toast } from '../ui';
import { INVITE_DAYS, NEW_CHARACTER, accessUrl, lastInviterName, makeInvite, playableCharacters, type InviteFor } from '../invite';

const FOR_WORDS: Record<InviteFor, { title: string; line: string; as: string; needs: string }> = {
  contributor: { title: 'A contributor', line: 'Sees the whole world and adds to it.', as: 'a contributor', needs: 'They need a free account.' },
  player: { title: 'A player', line: 'Sees only what their Character knows. No account needed.', as: 'a player', needs: 'No account needed: they open it in Lantern.' },
  guest: { title: 'A player with an account', line: 'The same, signed in to an account of their own.', as: 'a player with an account', needs: 'They need a free account.' },
};

const SVG = 'http://www.w3.org/2000/svg';

/** The link as a QR code: dark modules as one path, a quiet zone of four, black on white to scan. */
async function qrCode(text: string): Promise<SVGSVGElement> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + 8;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'invite-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The invite link as a QR code');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#fff');
  const ink = document.createElementNS(SVG, 'path');
  ink.setAttribute('d', d);
  ink.setAttribute('fill', '#000');
  svg.append(bg, ink);
  return svg;
}

export function inviteSheet(worldId: string, worldName: string): void {
  sheet((close) => {
    let inviteFor: InviteFor = 'contributor';
    const choice = (r: InviteFor) => {
      const b = h(
        'button',
        { class: 'choice', type: 'button', 'data-role': r, 'aria-pressed': String(r === inviteFor) },
        h('b', null, FOR_WORDS[r].title),
        h('span', null, FOR_WORDS[r].line),
      );
      b.addEventListener('click', () => {
        inviteFor = r;
        showChoice();
      });
      return b;
    };
    const roles = h(
      'div',
      { class: 'stack', role: 'group', 'aria-label': 'Who the link is for' },
      choice('contributor'),
      choice('player'),
      choice('guest'),
    );
    // Who a player reads as: a new Character they name, or one of the world's that keel holds.
    const playsAs = h('select', { class: 'input', 'aria-label': 'They play as', name: 'plays-as' }) as HTMLSelectElement;
    playsAs.appendChild(h('option', { value: NEW_CHARACTER }, 'A new Character for them'));
    void Promise.all([db.allElements(worldId), db.outboxRows(worldId)]).then(([els, rows]) => {
      for (const c of playableCharacters(els, rows)) playsAs.appendChild(h('option', { value: c.id }, c.name));
    }).catch(() => undefined);
    const playsAsField = h('label', { class: 'field-label', 'data-role': 'plays-as' }, 'They play as', playsAs);
    const needs = h('p', { class: 'dim', style: 'margin:0', 'data-role': 'invite-needs' });
    const showChoice = () => {
      for (const o of roles.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o.dataset.role === inviteFor));
      playsAsField.hidden = inviteFor !== 'player';
      needs.textContent = `It works once, for ${INVITE_DAYS} days. ${FOR_WORDS[inviteFor].needs}`;
    };
    const name = h('input', { class: 'input', type: 'text', 'aria-label': 'Your name, as they will see it', placeholder: 'Your name, as they will see it', value: lastInviterName() });
    const err = h('p', { class: 'error', role: 'alert' });
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    const make = h('button', { class: 'btn btn-standard', type: 'button', 'data-action': 'make-invite' }, 'Make the link');
    const body = h(
      'div',
      { class: 'stack' },
      h('p', { class: 'dim', style: 'margin:0' }, 'Who is it for?'),
      roles,
      playsAsField,
      name,
      needs,
      err,
      h('div', { class: 'row-gap' }, cancel, make),
    );
    showChoice();

    // Everything the link is made from is locked while keel makes it: a choice tapped during the
    // wait named a role the link did not have (Atlas 1.47's gate, H1). The role sent is the role
    // said, and the Character too.
    const lock = (on: boolean) => {
      for (const el of [make, cancel, name, playsAs, ...roles.querySelectorAll('button')] as (HTMLButtonElement | HTMLInputElement | HTMLSelectElement)[]) el.disabled = on;
    };
    make.addEventListener('click', async () => {
      lock(true);
      err.textContent = '';
      const sentFor = inviteFor;
      const character = playsAs.value || NEW_CHARACTER;
      const characterName = sentFor === 'player' && character !== NEW_CHARACTER ? playsAs.selectedOptions[0]?.textContent ?? null : null;
      try {
        const made = await makeInvite(worldId, sentFor, name.value, character);
        const done = h('button', { class: 'btn', type: 'button' }, 'Done');
        done.addEventListener('click', close);
        const copy = h('button', { class: 'btn', type: 'button', 'data-action': 'copy-invite' }, 'Copy');
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(made.line);
            toast('Copied the invite.');
          } catch {
            toast('Could not copy here. Press on the link to select it.');
          }
        });
        const buttons: HTMLElement[] = [];
        if (typeof navigator.share === 'function') {
          const share = h('button', { class: 'btn btn-standard', type: 'button', 'data-action': 'share-invite' }, 'Send it');
          share.addEventListener('click', () => {
            navigator.share({ title: `An invite to ${worldName}`, text: made.line }).catch(() => undefined);
          });
          buttons.push(share);
        }
        buttons.push(copy);
        const qr = h('div', { class: 'invite-qr-box' });
        body.replaceChildren(
          h(
            'p',
            { style: 'margin:0', 'data-role': 'invite-lead' },
            characterName
              ? `Your invite to ${worldName}, as a player reading as ${characterName}:`
              : `Your invite to ${worldName}, as ${FOR_WORDS[sentFor].as}:`,
          ),
          h('p', { class: 'invite-link', 'data-role': 'invite-link' }, made.link),
          h('div', { class: 'row-gap' }, ...buttons),
          qr,
          h('p', { class: 'dim', style: 'margin:0' }, 'Shown only now: Lantern does not keep it. You can make another at any time.'),
          h('a', { class: 'dim', href: accessUrl(worldId), target: '_blank', rel: 'noopener' }, 'See or take back links on onlyworlds.com'),
          h('div', { class: 'row-gap' }, done),
        );
        qrCode(made.link).then((svg) => qr.appendChild(svg)).catch(() => qr.remove());
      } catch (e) {
        err.textContent = errorText(e);
        lock(false);
      }
    });

    return [h('h2', null, 'Invite someone'), body];
  }, 'Invite someone');
}
