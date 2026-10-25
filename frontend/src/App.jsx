import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const API = 'http://127.0.0.1:8000'
const SCALE = 1.25
const MIN_W = 340
const GRIP_HALF = 5
const MAX_FOLLOW = 2

async function api(path, body) {
  const r = await fetch(API + path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error((await r.text()).slice(0, 300))
  return r.json()
}

const refOf = (lines, page) =>
  lines ? (lines[0] === lines[1] ? `L${lines[0]}` : `L${lines[0]}-${lines[1]}`) : `p${page}`

function chipOf(s) {
  if (s.source === 'image') return ['picture', `Picture · p${s.page} · model's reading`]
  if (s.kind === 'background') return ['bg', 'Background']
  const where = refOf(s.lines, s.page) + (s.lines && !s.precise ? ' (approx.)' : '')
  if (s.kind === 'authors_claim') return ['auth', `Authors' claim · ${where}`]
  return ['paper', `${s.source === 'pdf' ? 'Paper, from PDF' : 'Paper'} · ${where}`]
}

function Page({ pdf, n, hls, onSelect, reg }) {
  const [size, setSize] = useState(null)
  const [vis, setVis] = useState(false)
  const [drag, setDrag] = useState(null)
  const box = useRef(null)
  const canvas = useRef(null)
  const page = useRef(null)
  const drawn = useRef(false)

  useEffect(() => {
    let alive = true
    pdf.getPage(n).then(p => {
      if (!alive) return
      page.current = p
      const v = p.getViewport({ scale: SCALE })
      setSize([v.width, v.height])
    })
    return () => { alive = false }
  }, [pdf, n])

  useEffect(() => {
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setVis(true) }, { rootMargin: '900px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!size || !vis || drawn.current) return
    drawn.current = true
    const v = page.current.getViewport({ scale: SCALE })
    const c = canvas.current
    c.width = v.width
    c.height = v.height
    page.current.render({ canvasContext: c.getContext('2d'), viewport: v })
  }, [size, vis])

  const pos = e => {
    const r = box.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const down = e => {
    if (e.button !== 0) return
    const [x, y] = pos(e)
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }
  const move = e => {
    if (!drag) return
    const [x, y] = pos(e)
    setDrag({ ...drag, x1: x, y1: y })
  }
  const up = () => {
    if (!drag) return
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1)
    const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1)
    setDrag(null)
    if (x1 - x0 > 6 && y1 - y0 > 6) onSelect(n, [x0 / SCALE, y0 / SCALE, x1 / SCALE, y1 / SCALE])
  }

  const w = size ? size[0] : 612 * SCALE
  const h = size ? size[1] : 792 * SCALE
  const r = drag && {
    l: Math.min(drag.x0, drag.x1), t: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0),
  }
  return (
    <div className="page" style={{ width: w, height: h }}
      ref={el => { box.current = el; reg(n, el) }}
      onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}>
      <canvas ref={canvas} />
      {hls.filter(x => x.page === n).map((x, i) => (
        <div key={i} className={'hl ' + x.cls} style={{
          left: x.bbox[0] * SCALE, top: x.bbox[1] * SCALE,
          width: (x.bbox[2] - x.bbox[0]) * SCALE, height: (x.bbox[3] - x.bbox[1]) * SCALE,
        }} />
      ))}
      {r && <div className="drag" style={{ left: r.l, top: r.t, width: r.w, height: r.h }} />}
      <div className="pno">p{n}</div>
    </div>
  )
}

function Viewer({ url, hls, onSelect, jump }) {
  const [pdf, setPdf] = useState(null)
  const scroller = useRef(null)
  const els = useRef({})

  useEffect(() => {
    if (!url) return
    let alive = true
    setPdf(null)
    pdfjs.getDocument({ url, disableRange: true, disableStream: true }).promise
      .then(d => { if (alive) setPdf(d) })
    return () => { alive = false }
  }, [url])

  useEffect(() => {
    if (!jump || !scroller.current) return
    const el = els.current[jump.page]
    if (el) scroller.current.scrollTo({ top: el.offsetTop + (jump.y || 0) * SCALE - 90, behavior: 'smooth' })
  }, [jump])

  if (!url) return <div className="viewer-empty">Your paper appears here. Drag a box over any part of a page to select it.</div>
  if (!pdf) return <div className="viewer-empty">Loading the PDF…</div>
  return (
    <div className="scroller" ref={scroller}>
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Page key={i + 1} pdf={pdf} n={i + 1} hls={hls} onSelect={onSelect}
          reg={(n, el) => { els.current[n] = el }} />
      ))}
    </div>
  )
}

function Ptrs({ list, onJump }) {
  if (!list || !list.length) return null
  return list.map((p, i) => (
    <details className="ptr" key={i}>
      <summary>The paper has text on this · {refOf(p.lines, p.page)}</summary>
      <div className="quote">{p.paper_quote}</div>
      <div className="small">{p.explanation}</div>
      {onJump && <button className="btn quiet" onClick={() => onJump(p)}>Show on the paper</button>}
    </details>
  ))
}

function AskCard({ a, crits, onSave }) {
  const [text, setText] = useState('')
  const [field, setField] = useState('')
  return (
    <div className="ask">
      <div className="muted">About your note: “{a.text.slice(0, 140)}{a.text.length > 140 ? '…' : ''}”</div>
      <div><b>{a.question}</b></div>
      <textarea placeholder="Your answer, in your own words (optional)" value={text} onChange={e => setText(e.target.value)} />
      <div className="row">
        <select value={field} onChange={e => setField(e.target.value)}>
          <option value="">Put it under… (optional)</option>
          {crits.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn primary" onClick={() => onSave(a, text.trim(), field, false)}>Save</button>
        <button className="btn" onClick={() => onSave(a, '', '', true)}>Dismiss</button>
      </div>
    </div>
  )
}

export default function App() {
  const [pid, setPid] = useState(null)
  const [crit, setCrit] = useState(null)
  const [walk, setWalk] = useState([])
  const [spans, setSpans] = useState([])
  const [notes, setNotes] = useState([])
  const [scores, setScores] = useState({})
  const [draft, setDraft] = useState({})
  const [status, setStatus] = useState(null)
  const [facts, setFacts] = useState({})
  const [checking, setChecking] = useState({})
  const [brief, setBrief] = useState(undefined)
  const [msgs, setMsgs] = useState([])
  const [walkAt, setWalkAt] = useState(-1)
  const [tab, setTab] = useState('read')
  const [anchor, setAnchor] = useState(null)
  const [mode, setMode] = useState('ask')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [retry, setRetry] = useState(null)
  const [asks, setAsks] = useState([])
  const [talk, setTalk] = useState({})
  const [defOpen, setDefOpen] = useState({})
  const [edit, setEdit] = useState(null)
  const [dispute, setDispute] = useState(null)
  const [shown, setShown] = useState({})
  const [cur, setCur] = useState([])
  const [jump, setJump] = useState(null)
  const [refs, setRefs] = useState(true)
  const [finished, setFinished] = useState(false)
  const [width, setWidth] = useState(() => Number(localStorage.getItem('panelW')) || 460)
  const nid = useRef(1000)
  const dragging = useRef(false)
  const inputRef = useRef(null)
  const endRef = useRef(null)
  const critEnd = useRef(null)
  const fileRef = useRef(null)
  const briefTried = useRef(false)
  const started = useRef({})

  const byId = useMemo(() => Object.fromEntries(spans.map(s => [s.id, s])), [spans])
  const critList = crit ? crit.criteria : []
  const cmap = useMemo(() => Object.fromEntries(critList.map(c => [c.id, c])), [crit])
  const activeCrit = cmap[tab]
  const tk = talk[tab] || {}
  const url = pid ? `${API}/papers/${pid}/pdf` : null
  const stOf = id => (status && status.criteria[id] ? status.criteria[id].status : 'empty')
  const skippedOf = id => !!(status && status.criteria[id] && status.criteria[id].skipped)
  const allowDispute = !status || status.allow_dispute !== false

  useEffect(() => { localStorage.setItem('panelW', String(Math.round(width))) }, [width])
  useEffect(() => { setMode(tab === 'read' ? 'ask' : 'note') }, [tab])
  useEffect(() => {
    if (endRef.current && tab === 'read') endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs.length, tab])
  useEffect(() => {
    if (critEnd.current && activeCrit) critEnd.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [tab, notes.length, tk.q, tk.thinking, (tk.helps || []).length, tk.ended])
  useEffect(() => {
    if (tab === 'brief' && pid && brief === null && !briefTried.current) {
      briefTried.current = true
      buildBrief(false)
    }
  }, [tab, pid, brief])
  useEffect(() => {
    if (!pid || !activeCrit || !status) return
    const key = pid + activeCrit.id
    if (started.current[key]) return
    started.current[key] = true
    const has = notes.some(n => n.field === activeCrit.id)
    if (!has && !skippedOf(activeCrit.id)) talkCall(activeCrit, 'open', [])
  }, [tab, pid, status])

  const fail = m => { setErr(m); setRetry(null) }
  async function run(label, fn) {
    setBusy(label); setErr(''); setRetry(null)
    try { await fn() } catch (e) {
      setErr(String(e.message || e))
      setRetry(() => () => run(label, fn))
    }
    setBusy('')
  }
  const addSpans = list => {
    if (list && list.length) setSpans(s => [...s, ...list.filter(x => !s.some(y => y.id === x.id))])
  }
  async function refresh(id = pid) {
    const r = await Promise.allSettled([
      api(`/notes/${id}`), api(`/scores/${id}`), api(`/draft/${id}`),
      api(`/criteria/status/${id}`), api(`/facts/${id}`)])
    const [n, s, d, st, f] = r
    if (n.status === 'fulfilled') setNotes(n.value)
    if (s.status === 'fulfilled') setScores(s.value)
    if (d.status === 'fulfilled') setDraft(d.value)
    if (st.status === 'fulfilled') setStatus(st.value)
    if (f.status === 'fulfilled') setFacts(f.value)
    const bad = r.find(x => x.status === 'rejected')
    if (bad) setErr('Some information could not be loaded: ' + String((bad.reason && bad.reason.message) || bad.reason).slice(0, 160))
  }
  const ev = (type, payload) => api('/events', { paper_id: pid, type, payload })
  const push = m => { const id = ++nid.current; setMsgs(a => [...a, { id, ...m }]); return id }
  const patch = (id, p) => setMsgs(a => a.map(m => (m.id === id ? { ...m, ...p } : m)))
  const copy = t => navigator.clipboard.writeText(t)
  const focusInput = () => setTimeout(() => { if (inputRef.current) inputRef.current.focus() }, 50)

  function upload(file) {
    if (!file) return
    run('Reading the paper…', async () => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(API + '/papers', { method: 'POST', body: fd })
      if (!r.ok) throw new Error(await r.text())
      const d = await r.json()
      const id = d.paper_id
      const [c, w, sp, th, br] = await Promise.all([
        api('/criteria'), api(`/walk/${id}`), api(`/papers/${id}/spans`), api(`/thread/${id}`), api(`/brief/${id}`)])
      setCrit(c); setWalk(w); setSpans(sp); setBrief(br || null)
      const restored = th.map((t, i) => {
        const k = t.kind === 'explain' ? w.indexOf(t.title) : -1
        return { id: 't' + i, role: t.role, kind: t.kind, title: t.title || '', text: t.text || '',
          sentences: t.sentences || [], declined: t.declined || '', step: k >= 0 ? k : undefined }
      })
      setMsgs(restored)
      const last = [...restored].reverse().find(m => m.step !== undefined)
      setWalkAt(last ? last.step : -1)
      briefTried.current = false
      started.current = {}
      setAsks([]); setTalk({}); setAnchor(null); setCur([]); setFacts({})
      setEdit(null); setDispute(null); setFinished(false)
      setPid(id); setTab('read')
      await refresh(id)
    })
  }

  async function step(i, simpler = false) {
    const sec = walk[i]
    if (!sec) return
    setTab('read'); setWalkAt(i); setErr('')
    const id = push({ role: 'assistant', kind: 'explain', title: sec + (simpler ? ' (simpler)' : ''), step: i, loading: true })
    try {
      const d = await api('/explain', { paper_id: pid, section: sec, simpler })
      addSpans(d.new_spans)
      patch(id, { loading: false, sentences: d.sentences })
    } catch (e) { patch(id, { loading: false, error: e.message }) }
  }

  function histFor() {
    return msgs
      .filter(m => !m.loading && !m.error && (m.role === 'user' ? m.text : (m.text || (m.sentences || []).length)))
      .slice(-6)
      .map(m => ({ role: m.role, text: m.role === 'user' ? m.text : (m.text || m.sentences.map(s => s.text).join(' ')) }))
  }

  async function ask(q) {
    const a = anchor
    const hist = histFor()
    setTab('read'); setText(''); setAnchor(null); setErr('')
    push({ role: 'user', kind: 'ask', text: q, context: a ? (a.text || a.label) : '' })
    const id = push({ role: 'assistant', kind: 'ask', loading: true })
    try {
      const d = a && a.kind === 'region'
        ? await api('/ask_selection', { paper_id: pid, page: a.page, rect: a.rect, question: q })
        : await api('/ask', { paper_id: pid, question: q, context: a && a.text ? a.text : '', history: hist })
      addSpans(d.new_spans)
      patch(id, { loading: false, sentences: d.sentences || [], declined: d.declined ? d.message : '' })
    } catch (e) { patch(id, { loading: false, error: e.message }) }
  }

  async function explainAnchor() {
    const a = anchor
    if (!a || a.kind !== 'span') return
    setTab('read'); setErr('')
    const id = push({ role: 'assistant', kind: 'explain', title: 'Selection · ' + a.label, loading: true })
    try {
      const d = await api('/explain_spans', { paper_id: pid, span_ids: a.spanIds })
      addSpans(d.new_spans)
      patch(id, { loading: false, sentences: d.sentences })
    } catch (e) { patch(id, { loading: false, error: e.message }) }
  }

  async function onSelect(page, rect) {
    if (!pid) return
    try {
      const d = await api('/select', { paper_id: pid, page, rect })
      if (d.kind === 'span') {
        addSpans([d.span])
        setAnchor({ kind: 'span', spanIds: [d.span.id], page, text: d.span.text.slice(0, 240),
          label: refOf(d.span.lines, d.span.page), bbox: d.span.bbox })
      } else {
        setAnchor({ kind: 'region', spanIds: [], page, rect, text: '', label: `area on p${page}`, bbox: rect })
      }
      focusInput()
    } catch (e) { fail(e.message) }
  }

  function jumpSpan(id) {
    const sp = byId[id]
    if (!sp) return
    setCur([id])
    setJump({ page: sp.page, y: sp.bbox[1], t: Date.now() })
  }
  function focusSentence(s) {
    const ids = (s.span_ids || []).filter(i => byId[i])
    setCur(ids)
    if (ids.length) jumpSpan(ids[0])
    else if (s.page) setJump({ page: s.page, y: 0, t: Date.now() })
  }
  function aboutSentence(s, m) {
    const ids = (s.span_ids || []).filter(i => byId[i])
    setAnchor({ kind: 'span', spanIds: ids, page: s.page, text: s.text, label: refOf(s.lines, s.page),
      bbox: ids.length ? byId[ids[0]].bbox : null })
    setMode(m)
    focusInput()
  }
  function aboutItem(it) {
    const sp = byId[it.span_id]
    setAnchor({ kind: 'span', spanIds: [it.span_id], page: it.page, text: it.text || it.quote || '',
      label: refOf(it.lines, it.page), bbox: sp ? sp.bbox : null })
    setMode('note')
    focusInput()
  }
  const jumpPtr = p => { if (p.span_id) jumpSpan(p.span_id) }

  async function verifyKeys(keys) {
    setChecking(c => ({ ...c, ...Object.fromEntries(keys.map(k => [k, true])) }))
    try {
      await api('/verify', { paper_id: pid, keys })
      await refresh()
    } catch (e) { /* the check can be run again later */ }
    setChecking(c => { const n = { ...c }; keys.forEach(k => delete n[k]); return n })
  }

  function addNote({ text: t, field = '', a = null, question = '' }) {
    const id = Date.now()
    return run('Saving…', async () => {
      await ev('note_added', {
        id, field, text: t, span_ids: a ? a.spanIds || [] : [], page: a ? a.page : null,
        rect: a && a.kind === 'region' ? a.rect : null, sentence: a ? a.text || '' : '', revisit: false, question,
      })
      await refresh()
      verifyKeys(['n' + id])
    })
  }

  function submitComposer() {
    const t = text.trim()
    if (!t) { fail(activeCrit || mode === 'note' ? 'Write something first.' : 'Type a question first.'); return }
    if (activeCrit) { answerPoint(activeCrit, t); return }
    if (mode === 'ask') ask(t)
    else { addNote({ text: t, field: '', a: anchor }); setText(''); setAnchor(null) }
  }

  function saveEdit() {
    const e = edit
    const t = e.text.trim()
    if (!t) { fail('Write something first.'); return }
    run('Saving…', async () => {
      if (e.kind === 'note') {
        const n = notes.find(x => x.id === e.id)
        if (n && t !== n.text) await ev('note_text_edited', { id: e.id, text: t })
      } else {
        await ev('draft_edited', { field: e.cid, idx: e.idx, text: t })
      }
      setEdit(null)
      await refresh()
      if (e.kind === 'note') verifyKeys(['n' + e.id])
    })
  }
  const moveNote = (n, f) => run('Saving…', async () => { await ev('note_field_set', { id: n.id, field: f, by: 'user' }); await refresh() })
  const removeNote = n => run('Saving…', async () => { await ev('note_removed', { id: n.id }); await refresh() })
  const toggleRevisit = n => run('Saving…', async () => { await ev('note_revisit', { id: n.id, value: !n.revisit }); await refresh() })
  const setSkip = (cid, v) => run('Saving…', async () => {
    await api('/skip', { paper_id: pid, criterion: cid, skipped: v })
    await refresh()
  })
  function saveDispute() {
    const reason = (dispute.text || '').trim()
    if (!reason) { fail('Write why you disagree with the check.'); return }
    run('Saving…', async () => {
      await api('/dispute', { paper_id: pid, key: dispute.key, reason })
      setDispute(null)
      await refresh()
    })
  }

  function setScore(cid, v) {
    const reason = (scores[cid] && scores[cid].reason) || ''
    run('Saving…', async () => {
      await api('/score', { paper_id: pid, criterion: cid, value: v, reason })
      await refresh()
    })
  }

  const turnsFor = c => notes.filter(n => n.field === c.id).sort((a, b) => a.id - b.id).slice(-4)
    .map(n => ({ q: n.question || '', a: n.text }))

  async function talkCall(c, kind, hist) {
    setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), thinking: true, touched: true, error: '', retry: null } }))
    try {
      const d = await api('/talk', { paper_id: pid, criterion: c.id, history: hist, kind })
      setTalk(x => {
        const o = x[c.id] || {}
        if (kind === 'explain') {
          return { ...x, [c.id]: { ...o, thinking: false, helps: [...(o.helps || []), d.text || d.question] } }
        }
        return { ...x, [c.id]: { ...o, thinking: false, q: d.done ? '' : d.question, source: d.source, why: d.why || '',
          helps: [], ended: false, deeper: kind === 'deeper' ? (o.deeper || 0) + 1 : 0 } }
      })
    } catch (e) {
      setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), thinking: false, error: String(e.message || e), retry: { kind, hist } } }))
    }
  }

  async function answerPoint(c, t) {
    const st = talk[c.id] || {}
    const q = st.q || ''
    const a = anchor
    const id = Date.now()
    const prior = turnsFor(c)
    setText(''); setAnchor(null); setErr('')
    setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), q: '', helps: [], ended: false, thinking: true, touched: true, error: '' } }))
    try {
      await ev('note_added', {
        id, field: c.id, text: t, span_ids: a ? a.spanIds || [] : [], page: a ? a.page : null,
        rect: a && a.kind === 'region' ? a.rect : null, sentence: a ? a.text || '' : '', revisit: false, question: q,
      })
      if (skippedOf(c.id)) await api('/skip', { paper_id: pid, criterion: c.id, skipped: false })
      await refresh()
      verifyKeys(['n' + id])
    } catch (e) {
      setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), thinking: false, error: String(e.message || e) } }))
      return
    }
    const hist = [...prior, { q, a: t }].slice(-4)
    if ((st.deeper || 0) < MAX_FOLLOW) {
      await talkCall(c, 'deeper', hist)
    } else {
      setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), thinking: false,
        q: `What else, if anything, would you add under ${c.tab}?`, source: 'template', why: '', deeper: 0 } }))
    }
  }

  function finishPart(c) {
    const has = notes.some(n => n.field === c.id) || !!(scores[c.id] && scores[c.id].value)
    run('Saving…', async () => {
      if (!has) await api('/skip', { paper_id: pid, criterion: c.id, skipped: true })
      setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), q: '', helps: [], ended: true, thinking: false, touched: true } }))
      await refresh()
    })
  }

  function reopen(c) {
    const go = () => setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), ended: false, touched: true,
      q: `What else, if anything, would you add under ${c.tab}?`, source: 'template', why: '', helps: [], deeper: 0 } }))
    if (skippedOf(c.id)) run('Saving…', async () => { await api('/skip', { paper_id: pid, criterion: c.id, skipped: false }); await refresh(); go() })
    else go()
  }

  function quick(c, which) {
    const st = talk[c.id] || {}
    const hist = turnsFor(c)
    if (which === 'dk') talkCall(c, 'explain', [])
    else if (which === 'angle') talkCall(c, 'angle', st.q ? [...hist, { q: st.q, a: '' }] : hist)
    else if (which === 'deeper') talkCall(c, 'deeper', hist)
    else if (which === 'more') {
      setTalk(x => ({ ...x, [c.id]: { ...(x[c.id] || {}), ended: false, touched: true, helps: [], deeper: 0,
        q: `What else, if anything, would you add under ${c.tab}?`, source: 'template', why: '' } }))
    }
    else if (which === 'done') finishPart(c)
    else if (which === 'reopen') reopen(c)
  }

  function nextPartFor(c) {
    const i = critList.findIndex(x => x.id === c.id)
    const order = [...critList.slice(i + 1), ...critList.slice(0, Math.max(i, 0))]
    const open = x => !(status && status.criteria[x.id] && status.criteria[x.id].addressed)
    return order.find(x => x.required && open(x)) || order.find(open) || null
  }

  function draftAll() {
    const edited = Object.values(draft).some(d => d.sentences.some(s => s.edits))
    if (edited && !window.confirm('Drafting again replaces the sentences you edited. Earlier versions stay in the history. Continue?')) return
    run('Sorting your notes, checking facts, and drafting each part. This can take about a minute.', async () => {
      const r = await api('/draft', { paper_id: pid, mode: 'stitch', field: null })
      setDraft(r.draft); setAsks(r.asks || [])
      await refresh()
      if (r.blocked) {
        const parts = []
        if (r.missing.length) parts.push(`Still to address: ${r.missing.map(m => m.tab).join(', ')}.`)
        if (r.conflicts.length) parts.push(`${r.conflicts.length} note${r.conflicts.length > 1 ? 's' : ''} conflict with the paper. Fix or remove them first.`)
        fail('The review can’t be drafted yet. ' + parts.join(' '))
      }
    })
  }
  function sortOnly() {
    run('Sorting your notes…', async () => {
      const r = await api('/sort', { paper_id: pid })
      setAsks(r.asks || [])
      await refresh()
    })
  }
  function copyReview() {
    run('Checking the review before copying…', async () => {
      const r = await api(`/finish/${pid}`, {})
      await refresh()
      if (!r.ok) {
        const parts = []
        if (r.missing.length) parts.push(`Still to address: ${r.missing.map(m => m.tab).join(', ')}.`)
        if (r.conflicts.length) parts.push(`${r.conflicts.length} note${r.conflicts.length > 1 ? 's' : ''} conflict with the paper.`)
        fail('The review can’t be copied yet. ' + parts.join(' '))
        return
      }
      setFinished(true)
      try { await copy(wholeText()) } catch (e) { fail('Could not copy automatically. Select the text in the review below and copy it.') }
    })
  }
  function answerAsk(a, t, field, dismiss) {
    if (dismiss) { setAsks(x => x.filter(y => y.key !== a.key)); return }
    if (!t && !field) { fail('Write an answer or choose a part first.'); return }
    run('Saving…', async () => {
      const id = Number(a.key.slice(1))
      const isNote = a.key[0] === 'n'
      if (t) await ev(isNote ? 'note_answer_added' : 'answer_added', { id, question: a.question, text: t })
      if (field) await ev(isNote ? 'note_field_set' : 'field_assigned', { id, field, by: 'user' })
      setAsks(x => x.filter(y => y.key !== a.key))
      await refresh()
    })
  }
  function buildBrief(force = false) {
    run('Building the brief. This takes about 30 seconds.', async () => {
      const b = await api('/brief', { paper_id: pid, force })
      setBrief(b)
    })
  }

  const noteFull = n => [n.text, ...(n.answers || []).map(a => a.text)].filter(Boolean).join(' ')
  const noteRef = n => {
    const sp = byId[(n.span_ids || []).find(i => byId[i])]
    return sp ? refOf(sp.lines, sp.page) : (n.page ? `p${n.page}` : '')
  }
  function jumpNote(n) {
    const id = (n.span_ids || []).find(i => byId[i])
    if (id) jumpSpan(id)
    else if (n.page) setJump({ page: n.page, y: n.rect ? n.rect[1] : 0, t: Date.now() })
  }
  function keyInfo(key) {
    if (key.startsWith('s:')) {
      const cid = key.slice(2)
      const sc = scores[cid]
      return sc && sc.reason ? { label: 'Your score reason', text: sc.reason, ref: '', cid } : null
    }
    const n = notes.find(x => x.id === Number(key.slice(1)))
    return n ? { label: 'Your note', text: noteFull(n), ref: noteRef(n), note: n } : null
  }
  function jumpKey(k) {
    const ki = keyInfo(k)
    if (!ki) return
    if (ki.note && (ki.note.span_ids || []).some(i => byId[i])) jumpSpan(ki.note.span_ids.find(i => byId[i]))
    else if (ki.cid) setTab(ki.cid)
    else if (ki.note && ki.note.field) setTab(ki.note.field)
  }
  function startFix(key) {
    if (key.startsWith('s:')) { setTab(key.slice(2)); return }
    const n = notes.find(x => x.id === Number(key.slice(1)))
    if (!n) return
    setTab(n.field || 'review')
    setEdit({ kind: 'note', id: n.id, text: n.text })
  }
  const refsOf = s => [...new Set((s.src || []).map(k => { const i = keyInfo(k); return i && i.ref }).filter(Boolean))].join(', ')
  const labelOf = (c, v) => { const o = c.scale.find(x => x.value === v); return o && o.label ? ` · ${o.label}` : '' }
  function sectionText(c) {
    const d = draft[c.id]
    const sc = scores[c.id]
    const own = notes.filter(n => n.field === c.id)
    const items = d && d.sentences.length
      ? d.sentences.map(s => s.text + (refs && refsOf(s) ? ` (${refsOf(s)})` : ''))
      : own.map(noteFull)
    const body = c.list && items.length > 1
      ? items.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : items.join(d && d.sentences.length && !c.list ? ' ' : '\n\n')
    const line = c.type === 'score' && sc && sc.value ? `Score: ${sc.value}${labelOf(c, sc.value)}` : ''
    return [line, body].filter(Boolean).join('\n')
  }
  const wholeText = () => critList.map(c => { const t = sectionText(c); return t ? `${c.name}\n${t}` : null }).filter(Boolean).join('\n\n')

  const conflicts = Object.keys(facts).filter(k =>
    keyInfo(k) && (facts[k].pointers || []).some(p => p.kind === 'contradicts') && !facts[k].disputed)

  function nextStep() {
    if (!status) return null
    const open = critList.find(c => c.required && status.criteria[c.id] && !status.criteria[c.id].addressed)
    if (open) return { text: `Next: ${open.tab}`, hint: 'required', go: () => setTab(open.id) }
    if (conflicts.length) {
      return { text: `${conflicts.length} note${conflicts.length > 1 ? 's' : ''} conflict with the paper`,
        hint: 'fix before drafting', go: () => setTab('review') }
    }
    return { text: 'Everything required is dealt with', hint: 'draft your review', go: () => setTab('review') }
  }
  const nxt = nextStep()

  const hls = []
  cur.forEach(id => byId[id] && hls.push({ page: byId[id].page, bbox: byId[id].bbox, cls: 'cur' }))
  if (anchor && anchor.bbox) hls.push({ page: anchor.page, bbox: anchor.bbox, cls: 'anchor' })
  if (activeCrit) {
    notes.filter(n => n.field === tab).forEach(n =>
      (n.span_ids || []).forEach(i => byId[i] && hls.push({ page: byId[i].page, bbox: byId[i].bbox, cls: 'mark' })))
  }

  function onGripDown(e) { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true }
  function onGripMove(e) {
    if (!dragging.current) return
    setWidth(Math.max(MIN_W, Math.min(window.innerWidth * 0.72, window.innerWidth - e.clientX - GRIP_HALF)))
  }
  function onGripKey(e) {
    if (e.key === 'ArrowLeft') setWidth(w => Math.min(window.innerWidth * 0.72, w + 24))
    if (e.key === 'ArrowRight') setWidth(w => Math.max(MIN_W, w - 24))
  }

  const editor = () => (
    <div>
      <textarea value={edit.text} autoFocus onChange={e => setEdit({ ...edit, text: e.target.value })} />
      <div className="row">
        <button className="btn primary" onClick={saveEdit}>Save</button>
        <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
      </div>
    </div>
  )

  const anchorBar = (compact = false) => anchor && (
    <div className="anchor">
      <span className="muted">About</span>
      <button className="chip" onClick={() => (anchor.spanIds && anchor.spanIds[0]
        ? jumpSpan(anchor.spanIds[0])
        : setJump({ page: anchor.page, y: anchor.rect ? anchor.rect[1] : 0, t: Date.now() }))}>{anchor.label}</button>
      <span className="atext">{anchor.text ? anchor.text.slice(0, 100) : ''}</span>
      {!compact && anchor.kind === 'span' && <button className="btn quiet" onClick={explainAnchor}>Explain</button>}
      {!compact && anchor.kind === 'region' && <button className="btn quiet" onClick={() => ask('What does this show?')}>What does this show?</button>}
      <button className="btn quiet" aria-label="Clear the selection" onClick={() => setAnchor(null)}>×</button>
    </div>
  )

  function renderConflict(key) {
    const f = facts[key]
    if (!f) return null
    const bad = (f.pointers || []).filter(p => p.kind === 'contradicts')
    if (!bad.length) return null
    if (f.disputed) return <div className="skipped">You disagreed with the check: “{f.disputed}”</div>
    const dsp = dispute && dispute.key === key
    return (
      <div className="conflict">
        <b>This conflicts with the paper</b>
        {bad.map((p, i) => (
          <div key={i}>
            <div className="quote">{p.paper_quote}</div>
            <div className="small">{p.explanation}</div>
            <button className="chip paper" onClick={() => jumpPtr(p)}>Paper · {refOf(p.lines, p.page)}</button>
          </div>
        ))}
        <div className="muted">Change your note so it matches the paper, or remove it. The review can’t be drafted while this stands.</div>
        {dsp ? (
          <div>
            <div className="muted">Say why the check is wrong. Your reason is saved with the review history.</div>
            <textarea autoFocus value={dispute.text} onChange={e => setDispute({ ...dispute, text: e.target.value })} />
            <div className="row">
              <button className="btn primary" onClick={saveDispute}>Save my reason</button>
              <button className="btn" onClick={() => setDispute(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="btn" onClick={() => startFix(key)}>Edit my note</button>
            {allowDispute && <button className="btn quiet" onClick={() => setDispute({ key, text: '' })}>I disagree with this check</button>}
          </div>
        )}
      </div>
    )
  }

  function renderNote(n) {
    const key = 'n' + n.id
    const ed = edit && edit.kind === 'note' && edit.id === n.id
    const info = ((facts[key] && facts[key].pointers) || []).filter(p => p.kind !== 'contradicts')
    return (
      <div className="you-block" key={n.id}>
        <div className="meta">
          {n.revisit && <span className="flag">Come back to this</span>}
          {noteRef(n) && <button className="chip" onClick={() => jumpNote(n)}>{noteRef(n)}</button>}
          {n.field && n.field_by === 'auto' && <span>sorted by the assistant</span>}
          {n.edits ? <span>edited {n.edits}x</span> : null}
          {checking[key] && <span>checking against the paper…</span>}
        </div>
        {n.sentence && <div className="quote">{n.sentence}</div>}
        {n.question && <div className="muted">In answer to: {n.question}</div>}
        {ed ? editor() : <div className="pre">{n.text}</div>}
        {(n.versions || []).length > 0 && (
          <details className="ptr"><summary>Earlier versions of this note</summary>
            {n.versions.map((v, i) => <div className="small" key={i}>{v.old}</div>)}
          </details>
        )}
        {renderConflict(key)}
        <Ptrs list={info} onJump={jumpPtr} />
        {!ed && (
          <div className="row">
            <button className="btn quiet" onClick={() => setEdit({ kind: 'note', id: n.id, text: n.text })}>Edit</button>
            <button className="btn quiet" onClick={() => toggleRevisit(n)}>{n.revisit ? 'Done with this' : 'Come back to this'}</button>
            <select value="" onChange={e => e.target.value !== '' && moveNote(n, e.target.value === '__none' ? '' : e.target.value)}>
              <option value="">Move to…</option>
              {n.field && <option value="__none">Not sorted</option>}
              {critList.filter(c => c.id !== n.field).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn quiet" onClick={() => removeNote(n)}>Remove</button>
          </div>
        )}
      </div>
    )
  }

  function renderTurn(n) {
    const key = 'n' + n.id
    const ed = edit && edit.kind === 'note' && edit.id === n.id
    const info = ((facts[key] && facts[key].pointers) || []).filter(p => p.kind !== 'contradicts')
    return (
      <div key={n.id}>
        {n.question && <div className="ask"><b>{n.question}</b></div>}
        <div className="you-block">
          <div className="meta">
            {noteRef(n) && <button className="chip" onClick={() => jumpNote(n)}>{noteRef(n)}</button>}
            {n.edits ? <span>edited {n.edits}x</span> : null}
            {checking[key] && <span>checking against the paper…</span>}
          </div>
          {n.sentence && <div className="quote">{n.sentence}</div>}
          {ed ? editor() : <div className="pre">{n.text}</div>}
          {renderConflict(key)}
          <Ptrs list={info} onJump={jumpPtr} />
          {!ed && (
            <div className="row acts2">
              <button className="btn quiet" onClick={() => setEdit({ kind: 'note', id: n.id, text: n.text })}>Edit</button>
              <button className="btn quiet" onClick={() => removeNote(n)}>Remove</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderSentence(s, key) {
    const [cls, label] = chipOf(s)
    const quote = s.quote || (s.source === 'image' ? 'No exact text: this comes from a picture.' : 'A background definition, not from the paper.')
    return (
      <div className="sent" key={key}>
        <div className="stext">{s.text}</div>
        <div className="srow">
          <button className={'chip ' + cls} title="Show the exact text and jump to it"
            onClick={() => { focusSentence(s); setShown(o => ({ ...o, [key]: !o[key] })) }}>{label}</button>
          <span className="acts">
            <button className="btn quiet" onClick={() => aboutSentence(s, 'ask')}>Ask</button>
            <button className="btn quiet" onClick={() => aboutSentence(s, 'note')}>Note</button>
          </span>
        </div>
        {shown[key] && <div className="quote">{quote}</div>}
      </div>
    )
  }

  function renderMsg(m) {
    if (m.role === 'user') {
      return (
        <div className="you-block" key={m.id}>
          <div className="meta">You asked{m.context ? <span> · about “{m.context.slice(0, 70)}{m.context.length > 70 ? '…' : ''}”</span> : null}</div>
          <div className="pre">{m.text}</div>
        </div>
      )
    }
    return (
      <div className="asst" key={m.id}>
        {m.title && (
          <div className="mtitle">
            {m.step !== undefined && <span className="stepn">Step {m.step + 1} of {walk.length}</span>}{m.title}
          </div>
        )}
        {m.loading && <div className="muted working">Working. This can take up to 30 seconds.</div>}
        {m.error && <div className="errbar"><span>{m.error}</span></div>}
        {m.declined && <div className="declined">{m.declined}</div>}
        {m.sentences && m.sentences.length === 0 && !m.declined && !m.loading && !m.error && (
          <div className="muted">Nothing found in the paper for that.</div>
        )}
        {(m.sentences || []).map((s, i) => renderSentence(s, m.id + '-' + i))}
      </div>
    )
  }

  function renderRead() {
    return (
      <div>
        {msgs.length === 0 && (
          <div className="start">
            <h2 className="ttl">Where would you like to start?</h2>
            <div className="muted">The assistant explains the paper and shows where each sentence comes from. Judging it stays with you.</div>
            <ol className="how">
              <li>Read the paper with the assistant, or skip ahead.</li>
              <li>Open each part of the review form. The assistant asks, and you answer in your own words.</li>
              <li>On Full review, draft and copy the review.</li>
            </ol>
            <div className="row">
              <button className="btn primary" onClick={() => step(0)}>Walk me through the paper</button>
              <button className="btn" onClick={() => setTab('brief')}>Give me the brief</button>
              <button className="btn" onClick={() => { setMode('ask'); focusInput() }}>Ask about a part</button>
            </div>
          </div>
        )}
        {msgs.map(renderMsg)}
        {walkAt >= 0 && (
          <div className="walkbar">
            <span className="muted">Step {walkAt + 1} of {walk.length}</span>
            {walkAt > 0 && <button className="btn" onClick={() => step(walkAt - 1)}>Back</button>}
            <button className="btn" onClick={() => step(walkAt, true)}>Simpler</button>
            {walkAt < walk.length - 1 && <button className="btn primary" onClick={() => step(walkAt + 1)}>Next section</button>}
            <select value="" onChange={e => e.target.value !== '' && step(Number(e.target.value))}>
              <option value="">Jump to…</option>
              {walk.map((w, i) => <option key={w} value={i}>{w}</option>)}
            </select>
          </div>
        )}
        <div ref={endRef} />
      </div>
    )
  }

  function renderBrief() {
    const building = busy.startsWith('Building the brief')
    return (
      <div>
        <h2 className="ttl">Paper brief</h2>
        <div className="muted">What the authors put forward, in the paper's own order. It is their emphasis, not ours. Built once and saved.</div>
        {(brief === undefined || building) && <div className="muted working" style={{ marginTop: 12 }}>Building the brief. This takes about 30 seconds.</div>}
        {brief === null && !building && (
          <div className="row"><button className="btn primary" onClick={() => buildBrief(false)}>{err ? 'Try again' : 'Build the brief'}</button></div>
        )}
        {brief && brief.groups.map(g => (
          <div key={g.title}>
            <div className="bgrp">{g.title}</div>
            {g.items.length === 0 && <div className="muted">Nothing found.</div>}
            {g.items.map((it, i) => (
              <div className="bit" key={i}>
                <div className="stext">{it.text}</div>
                <div className="srow">
                  <button className="chip auth" onClick={() => jumpSpan(it.span_id)}>Authors · {refOf(it.lines, it.page)}</button>
                  <button className="btn quiet" onClick={() => aboutItem(it)}>Note</button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {brief && <div className="row"><button className="btn quiet" onClick={() => buildBrief(true)}>Rebuild the brief</button></div>}
      </div>
    )
  }

  function renderCriterion(c) {
    const mine = notes.filter(n => n.field === c.id).sort((a, b) => a.id - b.id)
    const sc = scores[c.id] || {}
    const cs = status && status.criteria[c.id]
    const st = talk[c.id] || {}
    const skipped = !!(cs && cs.skipped)
    const ended = !!st.ended || skipped
    const idle = !st.q && !st.thinking && !ended && !st.error
    const showIdle = idle && (mine.length > 0 || st.touched)
    const long = c.definition && c.definition.length > 260
    const open = defOpen[c.id]
    const nx = nextPartFor(c)
    return (
      <div>
        <h2 className="ttl">{c.name}</h2>
        <div className="reqline">
          {c.required ? 'Required by the form' : 'Optional'}
          {cs ? (cs.addressed ? ' · dealt with' : ' · still to address') : ''}
        </div>
        <section className="defn">
          <div className="muted">
            From the venue's review form{crit.version ? ` · ${crit.version}` : ''}
            {crit.source && <> · <a href={crit.source} target="_blank" rel="noreferrer">source</a></>}
          </div>
          {c.has_definition ? (
            <>
              <div className={'defn-text' + (long && !open ? ' defclamp' : '')}>{c.definition}</div>
              {long && <button className="btn quiet" onClick={() => setDefOpen(o => ({ ...o, [c.id]: !o[c.id] }))}>{open ? 'Show less' : 'Show all'}</button>}
            </>
          ) : <div className="muted">The venue's definition for this part has not been added yet.</div>}
        </section>

        {c.type === 'score' && (
          <section>
            <div className="sech">Your score</div>
            <div className="scale">
              {c.scale.map(o => (
                <button key={o.value} className={'opt' + (sc.value === o.value ? ' on' : '')} onClick={() => setScore(c.id, o.value)}>
                  <b>{o.value}</b>{o.label && <span>{o.label}</span>}
                </button>
              ))}
            </div>
            <div className="muted">You pick the score. The assistant never suggests one.</div>
            {renderConflict('s:' + c.id)}
          </section>
        )}

        <div className="thread">
          {mine.map(renderTurn)}

          {st.q && (
            <div className="ask">
              <div className="qlabel">{st.source === 'template' ? 'The assistant asks' : st.source === 'default' ? 'A generic question' + (st.why ? `: ${st.why}` : '') : "A question from the venue's definition"}</div>
              <b>{st.q}</b>
            </div>
          )}
          {(st.helps || []).map((h, i) => (
            <div className="help" key={i}><div className="qlabel">What this part of the form asks for</div>{h}</div>
          ))}
          {st.thinking && <div className="muted working">Thinking of what to ask next…</div>}
          {st.error && (
            <div className="errbar">
              <span>{st.error}</span>
              {st.retry && <button className="btn" onClick={() => talkCall(c, st.retry.kind, st.retry.hist)}>Retry</button>}
            </div>
          )}
          {ended && (
            <div className="done">{skipped && mine.length === 0 ? `Marked as no comment on ${c.tab}.` : `${c.tab} is done for now.`}</div>
          )}

          {!st.thinking && (
            <div className="qr">
              {st.q && (
                <>
                  <button className="btn pill" onClick={() => quick(c, 'dk')}>I don't know</button>
                  <button className="btn pill" onClick={() => quick(c, 'angle')}>Ask something else</button>
                  <button className="btn pill" onClick={() => quick(c, 'done')}>{mine.length || sc.value ? "I'm done with this part" : 'No comment on this part'}</button>
                </>
              )}
              {showIdle && (
                <>
                  <button className="btn pill" onClick={() => quick(c, 'more')}>{c.list ? 'Add another point' : 'Add more'}</button>
                  {mine.length > 0 && <button className="btn pill" onClick={() => quick(c, 'deeper')}>Ask me a follow-up</button>}
                  <button className="btn pill" onClick={() => quick(c, 'done')}>{mine.length || sc.value ? "I'm done with this part" : 'No comment on this part'}</button>
                </>
              )}
              {ended && (
                <>
                  <button className="btn primary pill" onClick={() => setTab(nx ? nx.id : 'review')}>{nx ? `Next: ${nx.tab}` : 'Go to the full review'}</button>
                  <button className="btn pill" onClick={() => quick(c, 'reopen')}>Add more here</button>
                </>
              )}
            </div>
          )}
          <div ref={critEnd} />
        </div>
      </div>
    )
  }

  function renderDraftItem(c, s, i) {
    const ed = edit && edit.kind === 'draft' && edit.cid === c.id && edit.idx === i
    return (
      <>
        {ed ? editor() : <div>{s.text}{s.edits ? <span className="muted"> · edited {s.edits}x</span> : null}</div>}
        <div className="srow">
          {(s.src || []).map(k => {
            const ki = keyInfo(k)
            return ki ? <button key={k} className="chip you" onClick={() => jumpKey(k)}>{ki.label}{ki.ref ? ` · ${ki.ref}` : ''}</button> : null
          })}
          {!ed && <button className="btn quiet" onClick={() => setEdit({ kind: 'draft', cid: c.id, idx: i, text: s.text })}>Edit</button>}
        </div>
        {(s.versions || []).length > 0 && (
          <details className="ptr"><summary>Earlier versions</summary>
            {s.versions.map((v, j) => <div className="small" key={j}>{v.old}</div>)}
          </details>
        )}
      </>
    )
  }

  function renderReview() {
    const unsorted = notes.filter(n => !n.field)
    const revisits = notes.filter(n => n.revisit)
    const missing = status ? status.missing : []
    const ready = missing.length === 0 && conflicts.length === 0
    const drafted = Object.values(draft).some(d => d.sentences.length)
    return (
      <div>
        <h2 className="ttl">Full review</h2>
        <div className="muted">Your review, built only from your own words. Check it, draft it, and copy it from here.</div>

        <div className={ready ? 'done' : 'need'}>
          <b>{ready ? 'Ready to draft' : 'Before you can draft'}</b>
          {missing.length > 0 && (
            <div>
              <div className="muted">Required parts still to address</div>
              {missing.map(m => (
                <div className="row" key={m.id}>
                  <button className="chip" onClick={() => setTab(m.id)}>{m.tab}</button>
                  <button className="btn quiet" onClick={() => setSkip(m.id, true)}>No comment</button>
                </div>
              ))}
            </div>
          )}
          {conflicts.length > 0 && (
            <div>
              <div className="muted">Notes that conflict with the paper</div>
              {conflicts.map(k => {
                const ki = keyInfo(k)
                return (
                  <div className="bit" key={k}>
                    <div className="muted">{ki.label}: “{ki.text.slice(0, 150)}{ki.text.length > 150 ? '…' : ''}”</div>
                    {renderConflict(k)}
                  </div>
                )
              })}
            </div>
          )}
          {unsorted.length > 0 && (
            <div className="muted">{unsorted.length} note{unsorted.length > 1 ? 's' : ''} not sorted yet. Drafting sorts them first, which can fill some required parts.</div>
          )}
          <div className="row">
            <button className="btn primary" onClick={draftAll}>{drafted ? 'Draft again' : 'Draft my review'}</button>
            {unsorted.length > 0 && <button className="btn" onClick={sortOnly}>Sort my notes now</button>}
          </div>
        </div>

        {asks.length > 0 && (
          <div className="need">
            <b>Questions about your notes</b>
            <div className="muted">The assistant could not tell where these notes belong.</div>
            {asks.map(a => <AskCard key={a.key} a={a} crits={critList} onSave={answerAsk} />)}
          </div>
        )}

        {unsorted.length > 0 && (
          <section>
            <div className="sech">Not sorted yet ({unsorted.length})</div>
            {unsorted.map(renderNote)}
          </section>
        )}
        {revisits.length > 0 && (
          <section>
            <div className="sech">To come back to ({revisits.length})</div>
            {revisits.map(renderNote)}
          </section>
        )}

        <div className="sech">The review so far</div>
        {critList.map(c => {
          const d = draft[c.id]
          const sc = scores[c.id]
          const own = notes.filter(n => n.field === c.id)
          const t = sectionText(c)
          const has = d && d.sentences.length > 0
          return (
            <div className="asm" key={c.id}>
              <div className="row" style={{ margin: 0 }}>
                <h3 className="asmh">{c.name}</h3>
                <span className="grow" />
                <button className="btn quiet" onClick={() => setTab(c.id)}>Open</button>
                {t && <button className="btn quiet" onClick={() => copy(t)}>Copy</button>}
              </div>
              {c.type === 'score' && sc && sc.value && <div className="scoreline">Score: {sc.value}{labelOf(c, sc.value)}</div>}
              {has && d.fallback && <div className="muted">A checked draft could not be built, so this shows your notes exactly as written.</div>}
              {has && (c.list && d.sentences.length > 1 ? <ol>{d.sentences.map((s, i) => <li key={i}>{renderDraftItem(c, s, i)}</li>)}</ol>
                : d.sentences.map((s, i) => <div className="dsent" key={i}>{renderDraftItem(c, s, i)}</div>))}
              {!has && own.length > 0 && <div className="muted">Not drafted yet. Your notes: {own.map(noteFull).join(' / ')}</div>}
              {!has && own.length === 0 && skippedOf(c.id) && <div className="muted">No comment.</div>}
              {!has && own.length === 0 && !skippedOf(c.id) && !(sc && sc.value) && <div className="muted">Nothing here yet.</div>}
            </div>
          )
        })}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={copyReview}>Copy review</button>
          <label className="chk"><input type="checkbox" checked={refs} onChange={e => setRefs(e.target.checked)} /> Include line references</label>
        </div>
        {finished && <div className="done">Copied. The review passed every check.</div>}
      </div>
    )
  }

  let content
  if (!pid) {
    content = (
      <div className="start">
        <h2 className="ttl">Review a paper</h2>
        <div className="muted">Upload the paper you are reviewing. Read it with the assistant, answer its questions in your own words, and the review form fills in as you go.</div>
        <div className="row"><button className="btn primary" onClick={() => fileRef.current.click()}>Upload paper</button></div>
      </div>
    )
  } else if (tab === 'brief') content = renderBrief()
  else if (tab === 'read') content = renderRead()
  else if (tab === 'review') content = renderReview()
  else if (activeCrit) content = renderCriterion(activeCrit)

  return (
    <div className="app">
      <header className="top">
        <span className="logo">Reviewer co-pilot</span>
        {crit && <span className="venue">{crit.venue}{crit.version ? ` · ${crit.version}` : ''}</span>}
        <span className="grow" />
        <button className="btn" onClick={() => fileRef.current.click()}>{pid ? 'Upload another paper' : 'Upload paper'}</button>
        <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={e => { upload(e.target.files[0]); e.target.value = '' }} />
      </header>
      <div className="main">
        <div className="left"><Viewer url={url} hls={hls} onSelect={onSelect} jump={jump} /></div>
        <div className="grip" role="separator" aria-orientation="vertical" aria-label="Resize the panel" tabIndex={0}
          onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={() => { dragging.current = false }} onKeyDown={onGripKey}><i /></div>
        <aside className="panel" style={{ width }}>
          {pid && status && (
            <div className="prog">
              <div className="ptxt">
                <b>{status.started} of {status.total}</b> parts of the review started
                {conflicts.length > 0 && <span className="bad"> · {conflicts.length} note{conflicts.length > 1 ? 's' : ''} conflict with the paper</span>}
                {status.unsorted > 0 && <span className="muted"> · {status.unsorted} not sorted yet</span>}
              </div>
              <div className="strip">
                {critList.map(c => (
                  <button key={c.id} className={'seg ' + stOf(c.id) + (skippedOf(c.id) ? ' skp' : '') + (tab === c.id ? ' cur' : '')}
                    title={`${c.tab}: ${skippedOf(c.id) ? 'no comment' : stOf(c.id)}`}
                    aria-label={`${c.tab}, ${skippedOf(c.id) ? 'no comment' : stOf(c.id)}`} onClick={() => setTab(c.id)} />
                ))}
              </div>
            </div>
          )}
          {pid && nxt && (
            <div className="next">
              <b>{nxt.text}</b><span className="muted">· {nxt.hint}</span>
              <span className="grow" />
              <button className="btn" onClick={nxt.go}>Go</button>
            </div>
          )}
          {pid && (
            <nav className="tabs">
              <button className={'tab' + (tab === 'brief' ? ' on' : '')} onClick={() => setTab('brief')}>Paper brief</button>
              <button className={'tab' + (tab === 'read' ? ' on' : '')} onClick={() => setTab('read')}>Read</button>
              <span className="tsep" />
              {critList.map(c => (
                <button key={c.id} className={'tab' + (tab === c.id ? ' on' : '')} onClick={() => setTab(c.id)}>
                  <i className={'mk ' + stOf(c.id) + (skippedOf(c.id) ? ' skp' : '')} />{c.tab}
                </button>
              ))}
              <span className="tsep" />
              <button className={'tab' + (tab === 'review' ? ' on' : '')} onClick={() => setTab('review')}>Full review</button>
            </nav>
          )}
          {busy && <div className="busy" role="status"><div className="indet" /><span>{busy}</span></div>}
          <div className="body">
            {err && (
              <div className="errbar">
                <span>{err}</span>
                {retry && <button className="btn" onClick={retry}>Retry</button>}
                <button className="btn quiet" onClick={() => { setErr(''); setRetry(null) }}>Dismiss</button>
              </div>
            )}
            {crit && crit.error && <div className="errbar"><span>The criteria file has a problem: {crit.error}</span></div>}
            {content}
          </div>
          {pid && (tab === 'read' || tab === 'brief') && (
            <div className="composer">
              {anchorBar()}
              <textarea ref={inputRef} value={text} rows={2}
                placeholder={mode === 'ask' ? 'Ask where something is, or what a term means' : 'Jot a thought. It will be sorted for you.'}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && ((mode === 'ask' && !e.shiftKey) || e.ctrlKey || e.metaKey)) { e.preventDefault(); submitComposer() }
                }} />
              <div className="crow">
                <div className="seg2" role="group" aria-label="What to do with the text">
                  <button className={mode === 'ask' ? 'on' : ''} onClick={() => setMode('ask')}>Ask the assistant</button>
                  <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>Jot a note</button>
                </div>
                <span className="grow" />
                <span className="muted">{mode === 'note' ? 'Sorted into the form later' : 'Enter sends'}</span>
                <button className="btn primary" onClick={submitComposer}>{mode === 'ask' ? 'Ask' : 'Save note'}</button>
              </div>
            </div>
          )}
          {pid && activeCrit && (
            <div className="composer">
              {anchorBar(true)}
              <textarea ref={inputRef} value={text} rows={2}
                placeholder={tk.q ? 'Your answer, in your own words' : 'Add a point in your own words'}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComposer() }
                }} />
              <div className="crow">
                <span className="muted">Enter sends · Shift+Enter for a new line</span>
                <span className="grow" />
                <button className="btn primary" onClick={submitComposer}>Send</button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}