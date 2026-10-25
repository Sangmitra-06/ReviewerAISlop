import json, os, re
from . import criteria, guide
from .llm import _chat

FALLBACK = {
    "summary": "In your own words, what is this paper about?",
    "strengths": "What, in your own words, are the reasons you would give for this paper?",
    "weaknesses": "What concerns, in your own words, would you want to raise?",
    "comments": "What would you want to tell the authors that is not a main concern?",
}
FOLLOW_FALLBACK = "What led you to that?"
ANGLE_FALLBACK = "What else, in your own words, would you say about {name}?"

PROMPT_SYS = """You help a paper reviewer think about one part of the review form by asking ONE short question.
The question comes from the venue's own definition of that part (given below) and from what the reviewer has already said. You never judge the paper, never say whether anything is good or bad, and never steer the reviewer toward a conclusion.
Rules for the question:
- It starts with What, How, Where, or Which.
- It is one sentence, under 25 words, and ends with a question mark.
- It does not contain the word "or" and offers no choices.
- Ask exactly one thing. Never join two questions with "and". Do not introduce ideas such as "claims", "baselines", or "comparisons" unless the reviewer or the definition used them.
- Opening question: ask what the reviewer thinks or would say about this part, using the definition's own wording. Examples of the shape: "What do you make of how the paper handles ethics?" or "What reasons would you give for this paper?" If the reviewer already wrote notes, build on them.
- Follow-up: build on the reviewer's own words, for example "You said the consent wording felt thin. What led you to that?" Use only words they wrote. Do not ask them to reinterpret what they said as a strength, a weakness, or a concern, and do not ask them to look something up. Do not add a new concern.
- Different angle: ask about an aspect of this part that the earlier questions did not cover, still in the definition's own wording. Do not repeat or reword an earlier question.
- Never repeat an earlier question.
Return JSON {"question": str}."""

JUDGE_SYS = """You audit a question an assistant wants to ask a paper reviewer about one part of a review form.
Return JSON {"leading": bool, "new_topic": bool, "reason": str}.
leading: the question presupposes a specific verdict or problem about THIS paper (for example "why is the baseline weak?"), nudges toward a particular answer, or asks the reviewer to reinterpret their own earlier remark as a strength, weakness, or concern. A question that simply asks what the reviewer thinks about the part, or what led them to a view, using the venue's own wording, is NOT leading.
new_topic: the question raises a concern, comparison, or fact about the paper that appears in neither the venue's definition nor the reviewer's words, or it introduces a concept the reviewer did not use (for example "how does it bear on the paper's claims")."""

EXPLAIN_SYS = """You explain, in plain words, what one part of a paper-review form is asking the reviewer to provide. Use only the venue's definition given below.
Rules: two or three short sentences. Say what the form asks for. Do not mention or judge any particular paper, do not give examples about one, do not say what a good answer would be, and never suggest a score, a verdict, or a point to make.
Return JSON {"text": str}."""


def prompt_errors(q, notes_text, d, name):
    errs = guide.rule_errors(q, notes_text, d)
    if re.search(r"\b(and|also)\s+(how|what|why|where|which|whether)\b", q, re.I):
        errs.append("asks two things; ask exactly one")
    if errs:
        return errs
    raw = _chat([{"role": "system", "content": JUDGE_SYS},
                 {"role": "user", "content": f"Part of the form: {name}\nThe venue's definition: {d}\n"
                                              f"Reviewer's words: {notes_text or '(none)'}\nQuestion: {q}"}])
    j = json.loads(raw)
    out = []
    if j.get("leading"):
        out.append("leading: " + str(j.get("reason", "")))
    if j.get("new_topic"):
        out.append("raises a topic that is in neither the definition nor the reviewer's words")
    return out


def explain_part(c):
    d = c["definition"].strip()[:3000] if c["has_definition"] else ""
    if not d:
        return {"done": False, "question": "", "source": "default",
                "text": f"This part of the form is called {c['name']}. The venue has not added a definition for it yet, so there is nothing more to explain.",
                "why": "no definition has been added for this part"}
    t = ""
    try:
        raw = _chat([{"role": "system", "content": EXPLAIN_SYS},
                     {"role": "user", "content": f"Part of the form: {c['name']}\nThe venue's definition:\n{d}"}])
        t = str(json.loads(raw).get("text", "")).strip()
    except Exception as e:
        print("[talk] explain failed:", repr(e)[:200])
    if not t or len(t) > 900:
        t = d[:500]
    return {"done": False, "question": "", "text": t, "source": "definition", "why": ""}


def next_question(cid, notes_text, history, kind="open"):
    c = criteria.by_id()[cid]
    if kind == "more":
        return {"done": False, "question": f"What else, if anything, would you add under {c['tab']}?",
                "source": "template", "why": ""}
    if kind == "explain":
        return explain_part(c)
    history = [h for h in (history or []) if isinstance(h, dict)]
    if kind == "deeper" and not history:
        kind = "open"
    if kind == "open":
        history = []
    d = c["definition"].strip()[:3000] if c["has_definition"] else ""
    if kind == "open":
        fb = FALLBACK.get(cid, f"In your own words, what would you put under {c['name']}?")
    elif kind == "angle":
        fb = ANGLE_FALLBACK.format(name=c["tab"])
    else:
        fb = FOLLOW_FALLBACK
    if not d:
        return {"done": False, "question": fb, "source": "default",
                "why": "no definition has been added for this part"}
    answered = " ".join(h.get("a", "") for h in history)
    pool = (notes_text + " " + answered).strip()
    earlier = [h.get("q", "") for h in history if h.get("q")]
    wanted = {"open": "an opening question", "deeper": "a follow-up on the reviewer's last answer",
              "angle": "a question from a different angle"}.get(kind, "an opening question")
    user = (f"Part of the form: {c['name']}\nThe venue's definition:\n{d}\n"
            f"The reviewer's notes so far: {notes_text or '(none)'}\n"
            f"Kind of question wanted: {wanted}\n"
            f"Earlier questions and the reviewer's answers: {json.dumps(history) if history else '(none yet)'}\n"
            f"Earlier questions to avoid repeating: {earlier}")
    msgs = [{"role": "system", "content": PROMPT_SYS}, {"role": "user", "content": user}]
    last = []
    for _ in range(3):
        raw, q = "", ""
        try:
            raw = _chat(msgs)
            q = json.loads(raw)["question"].strip()
            errs = prompt_errors(q, pool, d, c["name"])
        except Exception as e:
            errs = [f"invalid output: {e}"]
        if not errs:
            return {"done": False, "question": q, "source": "definition", "why": ""}
        last = errs
        print("[talk]", cid, kind, "retry:", errs[:3], "|", q)
        msgs += [{"role": "assistant", "content": raw or "{}"},
                 {"role": "user", "content": "Rewrite the question. Problems:\n" + "\n".join(errs)}]
    return {"done": False, "question": fb, "source": "default",
            "why": "no clean question after 3 tries: " + "; ".join(last[:2])}


def diagnose():
    out = []
    for c in criteria.items():
        out.append({"id": c["id"], "name": c["name"], "type": c["type"], "required": c["required"],
                    "definition": "found" if c["has_definition"] else "missing",
                    "definition_chars": len(c["definition"]) if c["has_definition"] else 0,
                    "scale_values": [x["value"] for x in c["scale"]],
                    "used_by": ["sorting notes", "questions"] if c["has_definition"] else []})
    return out