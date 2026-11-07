import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { fmtUsd, fmtDuration } from '../state/pricing.js';

// Confirm before credits are spent: what will be generated, how many takes, estimated cost.
export default function ConfirmSpend({ ask, onConfirm, onCancel }) {
  const [dontAsk, setDontAsk] = useState(false);
  return (
    <Dialog title={`Generate ${ask.count} item${ask.count === 1 ? '' : 's'} — ${ask.album}`} onClose={onCancel} width={560}
      footer={<><label className="row" style={{ margin: 0, marginRight: 'auto' }}><input type="checkbox" style={{ width: 'auto' }} checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} /> Don't ask again (Settings can turn it back on)</label>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" autoFocus onClick={() => onConfirm(dontAsk)}>Generate{ask.usd > 0 ? ` · ≈ ${fmtUsd(ask.usd)}` : ''}</button></>}>
      <p className="note">{ask.usd > 0 ? <>Estimated ≈ <b>{fmtUsd(ask.usd)}</b>{ask.ms ? ` for ${fmtDuration(ask.ms)} of music` : ''}.</> : <>Billed in ElevenLabs credits — no published dollar price for this (watch the 💲 credit bar).</>} Runs in the background queue; results land in this album whatever you open meanwhile.</p>
      <div className="wiz-list" style={{ maxHeight: 280, fontSize: 13 }}>
        {ask.lines.map((l, i) => <div key={i} className="row" style={{ padding: '2px 0' }}><span className="grow ell">{l.title || 'Untitled'}</span><span className="dim" style={{ fontSize: 12 }}>{l.detail}</span></div>)}
      </div>
    </Dialog>
  );
}
