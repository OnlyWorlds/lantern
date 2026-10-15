// Invite someone: the owner makes an invite link on the phone (keel C1, SDK 4.24) and sends it with
// the phone's share sheet, copies it, or shows its QR code across the table. The link is shown once:
// keel keeps only a hash, and Lantern keeps nothing. Seeing and taking back links is the website's.
import { h } from '../dom';
import { errorText, sheet, toast } from '../ui';
import { INVITE_DAYS, accessUrl, lastInviterName, makeInvite, type InviteRole } from '../invite';

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
    let role: InviteRole = 'contributor';
    const choice = (r: InviteRole, title: string, line: string) => {
      const b = h(
        'button',
        { class: 'choice', type: 'button', 'data-role': r, 'aria-pressed': String(r === role) },
        h('b', null, title),
        h('span', null, line),
      );
      b.addEventListener('click', () => {
        role = r;
        for (const o of roles.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o.dataset.role === r));
      });
      return b;
    };
    const roles = h(
      'div',
      { class: 'stack', role: 'group', 'aria-label': 'Who the link is for' },
      choice('contributor', 'A contributor', 'Sees the whole world and adds to it.'),
      choice('guest', 'A player', 'Sees only what their Character knows.'),
    );
    const name = h('input', { class: 'input', type: 'text', 'aria-label': 'Your name, as they will see it', placeholder: 'Your name, as they will see it', value: lastInviterName() });
    const err = h('p', { class: 'error', role: 'alert' });
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    const make = h('button', { class: 'btn btn-primary', type: 'button', 'data-action': 'make-invite' }, 'Make the link');
    const body = h(
      'div',
      { class: 'stack' },
      h('p', { class: 'dim', style: 'margin:0' }, 'Who is it for?'),
      roles,
      name,
      h('p', { class: 'dim', style: 'margin:0' }, `It works once, for ${INVITE_DAYS} days. They need a free account.`),
      err,
      h('div', { class: 'row-gap' }, cancel, make),
    );

    make.addEventListener('click', async () => {
      make.disabled = true;
      err.textContent = '';
      try {
        const made = await makeInvite(worldId, role, name.value);
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
          const share = h('button', { class: 'btn btn-primary', type: 'button', 'data-action': 'share-invite' }, 'Send it');
          share.addEventListener('click', () => {
            navigator.share({ title: `An invite to ${worldName}`, text: made.line }).catch(() => undefined);
          });
          buttons.push(share);
        }
        buttons.push(copy);
        const qr = h('div', { class: 'invite-qr-box' });
        body.replaceChildren(
          h('p', { style: 'margin:0' }, `Your invite to ${worldName}, as ${role === 'guest' ? 'a player' : 'a contributor'}:`),
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
        make.disabled = false;
      }
    });

    return [h('h2', null, 'Invite someone'), body];
  }, 'Invite someone');
}
