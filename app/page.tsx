"use client"

import { useState, useEffect, useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from "react"
import html2canvas from "html2canvas"
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts"

type MetricKey = "OTD" | "QA" | "SCAR" | "LTV" | "CV" | "RESP" | "DOC"

type FormData = {
  name: string
  period: string
  OTD: string
  QA: string
  SCAR: string
  LTV: string
  CV: string
  RESP: string
  DOC: string
}

type Weights = Record<MetricKey, number>

type RatingBand = {
  label: string
  emoji: string
  color: string
  light: string
  border: string
  tag: "PREFERRED" | "APPROVED" | "CONDITIONAL" | "AT RISK"
}

type BatchRow = {
  Supplier: string
  Period: string
  OTD: string
  QA: string
  SCAR: string
  LTV: string
  CV: string
  RESP: string
  DOC: string
}

type ScoredBatchRow = BatchRow & {
  normalized: Record<MetricKey, number>
  score: number
  band: RatingBand
}

type MetricMeta = {
  key: MetricKey
  fullLabel: string
  unit: string
  min: number
  max: number
  step: number
  placeholder: string
  helper: string
  tip: string
}

function normalizeOTD(v: string | number) {
  return Math.min(100, Math.max(0, parseFloat(String(v)) || 0))
}

function normalizeQA(v: string | number) {
  return Math.min(100, Math.max(0, parseFloat(String(v)) || 0))
}

function normalizeSCAR(v: string | number) {
  return Math.max(0, 100 - (Math.min(parseFloat(String(v)) || 0, 5) / 5) * 100)
}

function normalizeLTV(v: string | number) {
  const a = Math.abs(parseFloat(String(v)) || 0)
  if (a === 0) return 100
  if (a <= 1) return 90 + (1 - a) * 10
  if (a <= 5) return 50 + ((5 - a) / 4) * 40
  if (a <= 10) return 0 + ((10 - a) / 5) * 50
  return 0
}

function normalizeCV(v: string | number) {
  const a = Math.abs(parseFloat(String(v)) || 0)
  if (a === 0) return 100
  if (a <= 2) return 80 + ((2 - a) / 2) * 20
  if (a <= 5) return 50 + ((5 - a) / 3) * 30
  if (a <= 10) return 0 + ((10 - a) / 5) * 50
  return 0
}

function normalizeRESP(v: string | number) {
  return ((parseFloat(String(v)) || 0) / 5) * 100
}

function normalizeDOC(v: string | number) {
  return Math.min(100, Math.max(0, parseFloat(String(v)) || 0))
}

function normalizeAll(raw: Record<MetricKey, string | number>) {
  return {
    OTD: normalizeOTD(raw.OTD),
    QA: normalizeQA(raw.QA),
    SCAR: normalizeSCAR(raw.SCAR),
    LTV: normalizeLTV(raw.LTV),
    CV: normalizeCV(raw.CV),
    RESP: normalizeRESP(raw.RESP),
    DOC: normalizeDOC(raw.DOC),
  }
}

function computeComposite(normalized: Record<MetricKey, number>, weights: Weights) {
  return ["OTD", "QA", "SCAR", "LTV", "CV", "RESP", "DOC"].reduce(
    (sum, k) => sum + (normalized[k as MetricKey] * weights[k as MetricKey]) / 100,
    0
  )
}

function getRatingBand(score: number): RatingBand {
  if (score >= 90) {
    return {
      label: "Preferred Supplier",
      emoji: "Star",
      color: "#16a34a",
      light: "#f0fdf4",
      border: "#86efac",
      tag: "PREFERRED",
    }
  }
  if (score >= 75) {
    return {
      label: "Approved Supplier",
      emoji: "Approved",
      color: "#65a30d",
      light: "#f7fee7",
      border: "#bef264",
      tag: "APPROVED",
    }
  }
  if (score >= 60) {
    return {
      label: "Conditional - Improvement Required",
      emoji: "Alert",
      color: "#d97706",
      light: "#fffbeb",
      border: "#fcd34d",
      tag: "CONDITIONAL",
    }
  }
  return {
    label: "At Risk - Escalation Required",
    emoji: "",
    color: "#dc2626",
    light: "#fef2f2",
    border: "#fca5a5",
    tag: "AT RISK",
  }
}

function adjustWeights(weights: Weights, changedKey: MetricKey, newValue: number) {
  const clamped = Math.min(100, Math.max(0, newValue))
  const others = Object.keys(weights).filter((k) => k !== changedKey) as MetricKey[]
  const remaining = 100 - clamped
  const oldSum = others.reduce((s, k) => s + weights[k], 0)
  const newW = { ...weights, [changedKey]: clamped }

  if (oldSum === 0) {
    const share = Math.floor(remaining / others.length)
    others.forEach((k) => {
      newW[k] = share
    })
    newW[others[0]] += remaining - share * others.length
  } else {
    others.forEach((k) => {
      newW[k] = Math.round((weights[k] / oldSum) * remaining)
    })
    const drift = 100 - Object.values(newW).reduce((s, v) => s + v, 0)
    newW[others[others.length - 1]] += drift
  }
  return newW
}

function parseCSV(text: string) {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim())

  if (lines.length < 2) {
    throw new Error("Please include a header row and at least one data row.")
  }

  const headers = lines[0].split(",").map((h) => h.trim())
  const required = ["Supplier", "Period", "OTD", "QA", "SCAR", "LTV", "CV", "RESP", "DOC"]
  const missing = required.filter((r) => !headers.includes(r))

  if (missing.length) {
    throw new Error(`Missing columns: ${missing.join(", ")}. Check your header row.`)
  }

  return lines.slice(1).map((line, i) => {
    const vals = line.split(",").map((v) => v.trim())
    if (vals.length < 9) {
      throw new Error(`Row ${i + 2} seems incomplete - expected 9 values, got ${vals.length}.`)
    }
    const obj = {} as BatchRow
    headers.forEach((h, j) => {
      ;(obj as Record<string, string>)[h] = vals[j] || ""
    })
    return obj
  })
}

function exportToCSV(rows: ScoredBatchRow[]) {
  const h = [
    "Rank",
    "Supplier",
    "Period",
    "OTD%",
    "QA%",
    "SCAR",
    "LTV_days",
    "CV%",
    "RESP_1to5",
    "DOC%",
    "CompositeScore",
    "RatingBand",
  ]
  const body = rows.map((r, i) =>
    [
      i + 1,
      r.Supplier,
      r.Period,
      r.OTD,
      r.QA,
      r.SCAR,
      r.LTV,
      r.CV,
      r.RESP,
      r.DOC,
      r.score.toFixed(1),
      r.band.label,
    ].join(",")
  )
  return [h.join(","), ...body].join("\n")
}

function useAnimatedNumber(target: number, duration = 600) {
  const [display, setDisplay] = useState(target)
  const prev = useRef(target)

  useEffect(() => {
    const start = prev.current
    const end = target
    const startTime = performance.now()
    let raf = 0

    function step(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(start + (end - start) * eased)
      if (progress < 1) {
        raf = requestAnimationFrame(step)
      } else {
        prev.current = end
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return display
}

const DEFAULT_WEIGHTS: Weights = { OTD: 30, QA: 25, SCAR: 15, LTV: 10, CV: 10, RESP: 5, DOC: 5 }

const SAMPLE_SUPPLIER = {
  name: "Acme Aerospace",
  period: "Q2 2025",
  OTD: "87",
  QA: "96.5",
  SCAR: "3",
  LTV: "4.2",
  CV: "2.1",
  RESP: "3",
  DOC: "91",
}

const SAMPLE_CSV = `Supplier,Period,OTD,QA,SCAR,LTV,CV,RESP,DOC
Acme Aerospace,Q2 2025,87,96.5,3,4.2,2.1,3,91
Delta Components,Q2 2025,92,98,1,-1.0,0.5,5,99
Gamma Machining,Q2 2025,74,88,7,8.5,4.2,2,78
Precision Parts Co,Q2 2025,65,79,9,12.0,6.8,2,70
Stellar Forgings,Q2 2025,95,99,0,-0.5,0.2,5,100`

const METRIC_GROUPS = [
  {
    id: "delivery",
    label: "Delivery Performance",
    description: "How reliably does this supplier deliver on time and on schedule?",
    metrics: ["OTD", "LTV"] as MetricKey[],
  },
  {
    id: "quality",
    label: "Quality & Compliance",
    description: "How good is the quality of parts and documentation received?",
    metrics: ["QA", "SCAR", "DOC"] as MetricKey[],
  },
  {
    id: "commercial",
    label: "Commercial & Relationship",
    description: "How well does this supplier manage cost and responsiveness?",
    metrics: ["CV", "RESP"] as MetricKey[],
  },
]

const METRIC_META: Record<MetricKey, MetricMeta> = {
  OTD: {
    key: "OTD",
    fullLabel: "On-Time Delivery %",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.1,
    placeholder: "e.g. 87",
    helper: "What % of orders arrived by the due date? (100% = always on time)",
    tip: "% of POs delivered on or before the due date",
  },
  QA: {
    key: "QA",
    fullLabel: "Quality Acceptance Rate %",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.1,
    placeholder: "e.g. 96.5",
    helper: "What % of received parts passed inspection? (100% = zero rejections)",
    tip: "% of parts accepted at receiving inspection",
  },
  SCAR: {
    key: "SCAR",
    fullLabel: "SCAR Count (Corrective Actions)",
    unit: "",
    min: 0,
    max: 20,
    step: 1,
    placeholder: "e.g. 3",
    helper: "How many Corrective Action Requests were issued? (0 = best, 5+ = maximum penalty)",
    tip: "Number of Supplier Corrective Action Requests issued this period",
  },
  LTV: {
    key: "LTV",
    fullLabel: "Lead Time Variance (days)",
    unit: "days",
    min: -30,
    max: 30,
    step: 0.1,
    placeholder: "e.g. +4.2 late, or -1.0 early",
    helper: "Average days early (negative) or late (positive) vs. quoted lead time. 0 is perfect.",
    tip: "Avg days early (-) or late (+) vs. quoted lead time",
  },
  CV: {
    key: "CV",
    fullLabel: "Cost Variance %",
    unit: "%",
    min: -20,
    max: 20,
    step: 0.1,
    placeholder: "e.g. +2.1 over, or -1.0 under budget",
    helper: "How much did actual cost differ from quoted price? Use minus for under-budget.",
    tip: "Actual cost vs. quoted/contracted price as a %",
  },
  RESP: {
    key: "RESP",
    fullLabel: "Responsiveness Score (1-5)",
    unit: "/5",
    min: 1,
    max: 5,
    step: 1,
    placeholder: "1 = very slow  5 = excellent",
    helper: "Rate how quickly and effectively this supplier responds to issues and requests.",
    tip: "1-5 rating of responsiveness to issues and requests",
  },
  DOC: {
    key: "DOC",
    fullLabel: "Documentation Compliance %",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.1,
    placeholder: "e.g. 91",
    helper: "What % of shipments included complete certs, test reports, and required docs?",
    tip: "% of shipments with complete, compliant documentation",
  },
}

const WEIGHT_COLORS: Record<MetricKey, string> = {
  OTD: "#3b82f6",
  QA: "#22c55e",
  SCAR: "#ef4444",
  LTV: "#f59e0b",
  CV: "#8b5cf6",
  RESP: "#06b6d4",
  DOC: "#f97316",
}

const BAND_DESCRIPTIONS = {
  PREFERRED:
    "This supplier consistently meets or exceeds all performance targets. Prioritize for future sourcing.",
  APPROVED:
    "This supplier performs well overall with only minor gaps. Continue monitoring quarterly.",
  CONDITIONAL:
    "Performance gaps exist in key areas. A corrective action plan should be initiated.",
  "AT RISK":
    "Significant performance issues detected. Immediate escalation and formal review required.",
}

const METRIC_SUGGESTIONS: Record<MetricKey, string> = {
  OTD: "Work with supplier to identify root causes of late deliveries.",
  QA: "Review inspection failure patterns and request a quality improvement plan.",
  SCAR: "Initiate formal SCAR process and track corrective action closure.",
  LTV: "Request updated lead time commitments and review capacity planning.",
  CV: "Review pricing agreements and request cost breakdown justification.",
  RESP: "Escalate responsiveness concerns to supplier account manager.",
  DOC: "Provide documentation checklist and request compliance procedure.",
}

const INITIAL_FORM: FormData = {
  name: "",
  period: "",
  OTD: "",
  QA: "",
  SCAR: "",
  LTV: "",
  CV: "",
  RESP: "",
  DOC: "",
}

const WIZARD_STEPS = [
  { num: 1, label: "Supplier Info" },
  { num: 2, label: "Enter Metrics" },
  { num: 3, label: "Review Score" },
  { num: 4, label: "Export & Share" },
]

function formatMetricValue(key: MetricKey, value: string) {
  if (value === "") return "-"
  const meta = METRIC_META[key]
  if (key === "LTV") return `${parseFloat(value) > 0 ? "+" : ""}${value} ${meta.unit}`
  if (key === "RESP") return `${value}${meta.unit}`
  return `${value}${meta.unit ? ` ${meta.unit}` : ""}`.trim()
}

function getMetricError(key: MetricKey, value: string) {
  if (value === "") return ""
  const numeric = parseFloat(value)
  if (Number.isNaN(numeric)) {
    return `Please enter a number for ${METRIC_META[key].fullLabel}.`
  }
  const meta = METRIC_META[key]
  if (numeric < meta.min || numeric > meta.max) {
    return `Please enter a number between ${meta.min} and ${meta.max}.`
  }
  if (key === "RESP" && ![1, 2, 3, 4, 5].includes(numeric)) {
    return "Please choose a responsiveness score from 1 to 5."
  }
  return ""
}

function getCurrentDate() {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, "0")
  const dd = `${date.getDate()}`.padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "")
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function WizardProgressBar({
  currentStep,
  completedSteps,
  onStepClick,
}: {
  currentStep: 1 | 2 | 3 | 4
  completedSteps: Set<number>
  onStepClick: (step: 1 | 2 | 3 | 4) => void
}) {
  const progress = ((currentStep - 1) / (WIZARD_STEPS.length - 1)) * 100

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-700">Step {currentStep} of 4</div>
        <div className="text-sm text-slate-500">{Math.round(progress)}%</div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-5 grid grid-cols-4 gap-3">
        {WIZARD_STEPS.map((step, index) => {
          const isComplete = completedSteps.has(step.num)
          const isCurrent = currentStep === step.num
          const canClick = isComplete

          return (
            <button
              key={step.num}
              type="button"
              onClick={() => canClick && onStepClick(step.num as 1 | 2 | 3 | 4)}
              disabled={!canClick}
              className={`text-left ${canClick ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition ${
                    isComplete
                      ? "bg-green-600 text-white"
                      : isCurrent
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {isComplete ? "OK" : step.num}
                </div>
                {index < WIZARD_STEPS.length - 1 ? (
                  <div
                    className={`hidden h-0.5 flex-1 rounded-full md:block ${
                      completedSteps.has(step.num) ? "bg-green-500" : "bg-slate-200"
                    }`}
                  />
                ) : null}
              </div>
              <div
                className={`mt-2 text-xs font-semibold uppercase tracking-[0.14em] ${
                  isCurrent
                    ? "text-blue-700"
                    : isComplete
                      ? "text-green-700"
                      : "text-slate-400"
                }`}
              >
                {step.label}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeightPanel({
  weights,
  setWeights,
  open,
  setOpen,
  compactTrigger,
}: {
  weights: Weights
  setWeights: Dispatch<SetStateAction<Weights>>
  open: boolean
  setOpen: (value: boolean) => void
  compactTrigger?: string
}) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {compactTrigger || "Fine-tune scoring weights (optional)"}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            Default weights are pre-set by Curtiss-Wright standards.
          </div>
        </div>
        <div className="text-sm font-semibold text-slate-500">{open ? "Hide" : "Show"}</div>
      </button>
      {open ? (
        <div className="border-t border-slate-200 px-5 py-5">
          <div className="space-y-5">
            {(Object.keys(weights) as MetricKey[]).map((key) => (
              <div key={key} className="grid gap-2 md:grid-cols-[160px_1fr_56px] md:items-center">
                <div className="text-sm font-semibold" style={{ color: WEIGHT_COLORS[key] }}>
                  {key} - {METRIC_META[key].fullLabel}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={weights[key]}
                  onChange={(event) =>
                    setWeights((current) =>
                      adjustWeights(current, key, parseFloat(event.target.value) || 0)
                    )
                  }
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600"
                />
                <div className="text-right text-sm font-semibold text-slate-700">
                  {weights[key]}%
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => setWeights(DEFAULT_WEIGHTS)}
              className="text-sm font-semibold text-blue-700 hover:text-blue-800"
            >
              Reset to Defaults
            </button>
            <div
              className={`text-sm font-semibold ${total === 100 ? "text-green-700" : "text-amber-700"}`}
            >
              Total: {total}% {total === 100 ? "OK" : "Check"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single")
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM)
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const [welcomeClosing, setWelcomeClosing] = useState(false)
  const [batchCSV, setBatchCSV] = useState("")
  const [batchResults, setBatchResults] = useState<ScoredBatchRow[]>([])
  const [batchStep, setBatchStep] = useState<1 | 2 | 3>(1)
  const [batchError, setBatchError] = useState("")
  const [weightPanelOpen, setWeightPanelOpen] = useState(false)
  const [batchWeightPanelOpen, setBatchWeightPanelOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(true)
  const [apiKey, setApiKey] = useState("")
  const [aiSummary, setAiSummary] = useState("")
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState("")
  const [copiedSummary, setCopiedSummary] = useState(false)
  const [copiedTable, setCopiedTable] = useState(false)
  const [copiedBatchTable, setCopiedBatchTable] = useState(false)
  const exportCardRef = useRef<HTMLDivElement>(null)

  const normalized = useMemo(
    () =>
      normalizeAll({
        OTD: formData.OTD,
        QA: formData.QA,
        SCAR: formData.SCAR,
        LTV: formData.LTV,
        CV: formData.CV,
        RESP: formData.RESP,
        DOC: formData.DOC,
      }),
    [formData]
  )

  const score = useMemo(() => computeComposite(normalized, weights), [normalized, weights])
  const band = useMemo(() => getRatingBand(score), [score])
  const animatedScore = useAnimatedNumber(score)

  const step1Valid = formData.name.trim().length >= 2 && formData.period.trim().length > 0
  const metricErrors = useMemo(
    () =>
      (Object.keys(METRIC_META) as MetricKey[]).reduce(
        (acc, key) => {
          acc[key] = getMetricError(key, formData[key])
          return acc
        },
        {} as Record<MetricKey, string>
      ),
    [formData]
  )
  const step2Valid = (Object.keys(METRIC_META) as MetricKey[]).every(
    (key) => formData[key] !== "" && !metricErrors[key]
  )
  const completedMetricCount = (Object.keys(METRIC_META) as MetricKey[]).filter(
    (key) => formData[key] !== "" && !metricErrors[key]
  ).length

  const radarData = useMemo(
    () => [
      { metric: "OTD", score: normalized.OTD, fullMark: 100 },
      { metric: "Quality", score: normalized.QA, fullMark: 100 },
      { metric: "SCAR", score: normalized.SCAR, fullMark: 100 },
      { metric: "Lead Time", score: normalized.LTV, fullMark: 100 },
      { metric: "Cost", score: normalized.CV, fullMark: 100 },
      { metric: "Resp", score: normalized.RESP, fullMark: 100 },
      { metric: "Docs", score: normalized.DOC, fullMark: 100 },
    ],
    [normalized]
  )

  const metricRows = useMemo(
    () =>
      (Object.keys(METRIC_META) as MetricKey[]).map((key) => ({
        key,
        label: METRIC_META[key].fullLabel,
        raw: formData[key],
        normalized: normalized[key],
        weight: weights[key],
        contribution: (normalized[key] * weights[key]) / 100,
      })),
    [formData, normalized, weights]
  )

  const lowestMetric = useMemo(
    () => metricRows.reduce((lowest, current) => (current.normalized < lowest.normalized ? current : lowest)),
    [metricRows]
  )

  const highestMetric = useMemo(
    () => metricRows.reduce((highest, current) => (current.normalized > highest.normalized ? current : highest)),
    [metricRows]
  )

  const batchStats = useMemo(
    () => ({
      total: batchResults.length,
      preferred: batchResults.filter((row) => row.band.tag === "PREFERRED").length,
      approved: batchResults.filter((row) => row.band.tag === "APPROVED").length,
      conditional: batchResults.filter((row) => row.band.tag === "CONDITIONAL").length,
      atRisk: batchResults.filter((row) => row.band.tag === "AT RISK").length,
    }),
    [batchResults]
  )

  const batchChartData = useMemo(
    () =>
      batchResults.slice(0, 6).map((row) => ({
        name: row.Supplier,
        score: Number(row.score.toFixed(1)),
        color: row.band.color,
      })),
    [batchResults]
  )

  useEffect(() => {
    if (!copiedSummary) return
    const timer = window.setTimeout(() => setCopiedSummary(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copiedSummary])

  useEffect(() => {
    if (!copiedTable) return
    const timer = window.setTimeout(() => setCopiedTable(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copiedTable])

  useEffect(() => {
    if (!copiedBatchTable) return
    const timer = window.setTimeout(() => setCopiedBatchTable(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copiedBatchTable])

  useEffect(() => {
    if (!welcomeClosing) return
    const timer = window.setTimeout(() => {
      setWelcomeDismissed(true)
      setWelcomeClosing(false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [welcomeClosing])

  const moveToStep = useCallback((step: 1 | 2 | 3 | 4) => setWizardStep(step), [])

  const completeAndGo = useCallback((current: number, next: 1 | 2 | 3 | 4) => {
    setCompletedSteps((prev) => new Set([...prev, current]))
    setWizardStep(next)
  }, [])

  const updateField = useCallback((key: keyof FormData, value: string) => {
    setFormData((current) => ({ ...current, [key]: value }))
  }, [])

  const fillSampleMetrics = useCallback(() => {
    setFormData((current) => ({
      ...current,
      OTD: SAMPLE_SUPPLIER.OTD,
      QA: SAMPLE_SUPPLIER.QA,
      SCAR: SAMPLE_SUPPLIER.SCAR,
      LTV: SAMPLE_SUPPLIER.LTV,
      CV: SAMPLE_SUPPLIER.CV,
      RESP: SAMPLE_SUPPLIER.RESP,
      DOC: SAMPLE_SUPPLIER.DOC,
    }))
  }, [])

  const singleCsvRows = useMemo(
    () =>
      metricRows.map((row) =>
        [
          formData.name,
          formData.period,
          row.label,
          row.raw,
          row.normalized.toFixed(1),
          row.weight,
          row.contribution.toFixed(1),
          score.toFixed(1),
          band.label,
        ].join(",")
      ),
    [metricRows, formData.name, formData.period, score, band.label]
  )

  const handleSingleCsvDownload = useCallback(() => {
    const header =
      "Supplier,Period,Metric,RawValue,NormalizedScore,Weight,Contribution,CompositeScore,RatingBand"
    const filename = `SupplierScore_${sanitizeFilePart(formData.name)}_${sanitizeFilePart(formData.period)}_${getCurrentDate()}.csv`
    downloadFile(filename, [header, ...singleCsvRows].join("\n"), "text/csv;charset=utf-8;")
  }, [formData.name, formData.period, singleCsvRows])

  const buildScoreTableText = useCallback(() => {
    const lines = [
      `SUPPLIER SCORECARD - ${formData.name} - ${formData.period}`,
      "================================================",
      `Overall Score: ${score.toFixed(1)}/100 - ${band.label} ${band.emoji}`,
      "",
    ]

    metricRows.forEach((row) => {
      lines.push(
        `${METRIC_META[row.key].fullLabel.padEnd(28)} ${String(row.raw).padEnd(7)} -> ${String(
          Math.round(row.normalized)
        ).padStart(3)}/100  (wt ${String(row.weight).padStart(2)}%)  = ${row.contribution.toFixed(1)}`
      )
    })

    lines.push("------------------------------------------------")
    lines.push(`COMPOSITE SCORE: ${score.toFixed(1).padStart(35)}`)
    lines.push("================================================")
    return lines.join("\n")
  }, [formData.name, formData.period, score, band.label, band.emoji, metricRows])

  const copySingleTable = useCallback(async () => {
    await navigator.clipboard.writeText(buildScoreTableText())
    setCopiedTable(true)
  }, [buildScoreTableText])

  const handlePngDownload = useCallback(async () => {
    if (!exportCardRef.current) return
    const canvas = await html2canvas(exportCardRef.current, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    })
    const url = canvas.toDataURL("image/png")
    const link = document.createElement("a")
    link.href = url
    link.download = `SupplierScore_${sanitizeFilePart(formData.name)}_${sanitizeFilePart(formData.period)}_${getCurrentDate()}.png`
    link.click()
  }, [formData.name, formData.period])

  const generateAiSummary = useCallback(async () => {
    if (!apiKey.trim()) {
      setAiError("Please enter an Anthropic API key before generating analysis.")
      return
    }

    setAiLoading(true)
    setAiError("")

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a senior supply chain analyst at a defense manufacturer. 
Write exactly 2 sentences about this supplier's performance evaluation:
Sentence 1: Highlight 2-3 specific strengths with exact metric values.
Sentence 2: Identify the single highest-priority improvement area with a concrete, actionable recommendation.
Tone: formal, professional, objective. No bullet points. No headers. Numbers must be cited.`,
          messages: [
            {
              role: "user",
              content: `Supplier: ${formData.name} | Period: ${formData.period} | Overall Score: ${score.toFixed(1)}/100 | Rating: ${band.label}
On-Time Delivery: ${formData.OTD}% (normalized ${normalized.OTD.toFixed(0)}/100, weight ${weights.OTD}%)
Quality Acceptance: ${formData.QA}% (normalized ${normalized.QA.toFixed(0)}/100, weight ${weights.QA}%)
SCAR Count: ${formData.SCAR} (normalized ${normalized.SCAR.toFixed(0)}/100, weight ${weights.SCAR}%)
Lead Time Variance: ${formData.LTV} days (normalized ${normalized.LTV.toFixed(0)}/100, weight ${weights.LTV}%)
Cost Variance: ${formData.CV}% (normalized ${normalized.CV.toFixed(0)}/100, weight ${weights.CV}%)
Responsiveness: ${formData.RESP}/5 (normalized ${normalized.RESP.toFixed(0)}/100, weight ${weights.RESP}%)
Documentation: ${formData.DOC}% (normalized ${normalized.DOC.toFixed(0)}/100, weight ${weights.DOC}%)`,
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error("AI service request failed.")
      }

      const data = await response.json()
      setAiSummary(data.content?.map((b: { text?: string }) => b.text || "").join("") || "No summary generated.")
    } catch {
      setAiError("Could not connect to AI service. Please try again.")
    } finally {
      setAiLoading(false)
    }
  }, [apiKey, formData, score, band.label, normalized, weights])

  const copyAiSummary = useCallback(async () => {
    if (!aiSummary) return
    await navigator.clipboard.writeText(aiSummary)
    setCopiedSummary(true)
  }, [aiSummary])

  const scoreBatchRows = useCallback(
    (rows: BatchRow[]) =>
      rows
        .map((row) => {
          const normalizedRow = normalizeAll({
            OTD: row.OTD,
            QA: row.QA,
            SCAR: row.SCAR,
            LTV: row.LTV,
            CV: row.CV,
            RESP: row.RESP,
            DOC: row.DOC,
          })
          const composite = computeComposite(normalizedRow, weights)
          return {
            ...row,
            normalized: normalizedRow,
            score: Number(composite.toFixed(1)),
            band: getRatingBand(composite),
          }
        })
        .sort((a, b) => b.score - a.score),
    [weights]
  )

  const handleBatchScore = useCallback(() => {
    try {
      const parsed = parseCSV(batchCSV)
      const scored = scoreBatchRows(parsed)
      setBatchResults(scored)
      setBatchError("")
      setBatchStep(2)
    } catch (error) {
      setBatchResults([])
      setBatchStep(1)
      setBatchError(
        error instanceof Error ? error.message : "Unable to process the CSV data provided."
      )
    }
  }, [batchCSV, scoreBatchRows])

  useEffect(() => {
    if (!batchResults.length) return
    setBatchResults((current) => scoreBatchRows(current))
  }, [weights, scoreBatchRows])

  const exportBatchCsv = useCallback(() => {
    if (!batchResults.length) return
    downloadFile(`SupplierScore_Batch_${getCurrentDate()}.csv`, exportToCSV(batchResults), "text/csv;charset=utf-8;")
  }, [batchResults])

  const copyBatchTable = useCallback(async () => {
    const header = [
      "RANKED SUPPLIER SCORECARD",
      "================================================",
      ...batchResults.map(
        (row, index) => `${index + 1}. ${row.Supplier} | ${row.Period} | ${row.score.toFixed(1)}/100 | ${row.band.label}`
      ),
      "================================================",
    ].join("\n")
    await navigator.clipboard.writeText(header)
    setCopiedBatchTable(true)
  }, [batchResults])

  const resetSingle = useCallback(() => {
    setWizardStep(1)
    setCompletedSteps(new Set())
    setFormData(INITIAL_FORM)
    setAiSummary("")
    setAiError("")
    setWeightPanelOpen(false)
    setBreakdownOpen(true)
  }, [])

  const resetBatch = useCallback(() => {
    setBatchCSV("")
    setBatchResults([])
    setBatchError("")
    setBatchStep(1)
  }, [])

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 text-slate-800">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-b border-slate-200 bg-white">
          <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-sm font-bold text-white">CW</div>
              <div>
                <h1 className="text-[18px] font-bold">CW SupplierScore</h1>
                <p className="text-[13px] text-slate-500">Supplier Performance Scoring Tool</p>
              </div>
            </div>
            <div className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-red-700 ring-1 ring-red-200">Internal Use Only</div>
          </div>
        </header>

        {!welcomeDismissed ? (
          <section className={`mt-6 rounded-3xl border border-blue-200 bg-blue-50 px-6 py-5 text-blue-800 shadow-sm transition-opacity duration-250 ${welcomeClosing ? "opacity-0" : "opacity-100"}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="max-w-3xl text-sm leading-6">
                  Welcome to CW SupplierScore - a quick scoring calculator for supplier reviews and sourcing decisions. No login required. Your data stays in your browser.
                </p>
              </div>
              <button type="button" onClick={() => setWelcomeClosing(true)} className="rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-blue-700">
                Got it ×
              </button>
            </div>
          </section>
        ) : null}

        <section className="mt-6 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-end gap-1">
          <button type="button" onClick={() => setActiveTab("single")} className={`border-b-2 px-6 py-3 text-sm font-medium ${activeTab === "single" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            Single Supplier
          </button>
          <button type="button" onClick={() => setActiveTab("batch")} className={`border-b-2 px-6 py-3 text-sm font-medium ${activeTab === "batch" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            Batch Mode {batchResults.length > 0 ? <span className="ml-1 text-xs">({batchResults.length} scored)</span> : null}
          </button>
          </div>
        </section>

        {activeTab === "single" ? (
          <section className="mt-6 space-y-6">
            <WizardProgressBar currentStep={wizardStep} completedSteps={completedSteps} onStepClick={moveToStep} />
            <div className="mx-auto max-w-[760px] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-lg">
              <div className="flex w-[400%] transition-transform duration-500 ease-out" style={{ transform: `translateX(-${(wizardStep - 1) * 25}%)` }}>
                <section className="w-1/4 flex-none px-8 py-8">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Step 1</p>
                  <h2 className="mt-3 text-2xl font-semibold text-slate-900">Let&apos;s start with the basics</h2>
                  <p className="mt-2 text-[15px] text-slate-500">Tell us which supplier you&apos;re evaluating and for which time period.</p>
                  <div className="mt-8 space-y-6">
                    <label className="block">
                      <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">Supplier Name</span>{formData.name.trim().length >= 2 ? <span className="text-sm font-semibold text-green-600">OK</span> : null}</div>
                      <input type="text" value={formData.name} onChange={(event) => updateField("name", event.target.value)} placeholder="e.g. Acme Aerospace" className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600" />
                      <p className="mt-2 text-sm text-slate-500">Enter the supplier&apos;s official name as it appears in your system.</p>
                    </label>
                    <label className="block">
                      <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">Scoring Period</span>{formData.period.trim() ? <span className="text-sm font-semibold text-green-600">OK</span> : null}</div>
                      <input type="text" value={formData.period} onChange={(event) => updateField("period", event.target.value)} placeholder="e.g. Q2 2025, Jan-Mar 2025, FY2025" className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600" />
                      <p className="mt-2 text-sm text-slate-500">What period does this scorecard cover?</p>
                    </label>
                  </div>
                  <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5">
                    <p className="text-sm text-slate-700">This scorecard is for a single point-in-time evaluation. Need to score multiple suppliers at once?</p>
                    <button type="button" onClick={() => setActiveTab("batch")} className="mt-3 text-sm font-semibold text-blue-700">Switch to Batch Mode -&gt;</button>
                  </div>
                  <button type="button" disabled={!step1Valid} onClick={() => completeAndGo(1, 2)} className={`mt-8 w-full rounded-2xl px-5 py-4 text-sm font-semibold text-white ${step1Valid ? "bg-blue-600 hover:bg-blue-700 animate-pulse" : "bg-slate-300"}`}>
                    Next: Enter Metrics -&gt;
                  </button>
                </section>

                <section className="w-1/4 flex-none px-8 py-8">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Step 2</p>
                      <h2 className="mt-3 text-2xl font-semibold text-slate-900">Enter Performance Metrics</h2>
                      <p className="mt-2 text-[15px] text-slate-500">Fill in the 7 metrics for {formData.name || "this supplier"}.</p>
                    </div>
                    <button type="button" onClick={fillSampleMetrics} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700">Use Sample Data</button>
                  </div>
                  <div className="mt-8 space-y-5">
                    {METRIC_GROUPS.map((group) => (
                      <div key={group.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-slate-400">{group.label}</div>
                        <p className="mt-2 text-sm italic text-slate-500">{group.description}</p>
                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                          {group.metrics.map((key) =>
                            key === "RESP" ? (
                              <div key={key} className="md:col-span-2">
                                <div className="text-sm font-semibold text-slate-800">{METRIC_META[key].fullLabel}</div>
                                <div className="mt-3 flex flex-wrap gap-3">
                                  {[1, 2, 3, 4, 5].map((option) => (
                                    <button key={option} type="button" onClick={() => updateField("RESP", String(option))} className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${formData.RESP === String(option) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                                      {option}
                                    </button>
                                  ))}
                                </div>
                                <p className="mt-2 text-xs text-slate-400">{METRIC_META[key].helper}</p>
                                {metricErrors[key] ? <p className="mt-2 text-xs text-red-600">{metricErrors[key]}</p> : null}
                              </div>
                            ) : (
                              <label key={key} className="block">
                                <div className="text-sm font-semibold text-slate-800">{METRIC_META[key].fullLabel}</div>
                                <div className="relative mt-2">
                                  <input type="number" min={METRIC_META[key].min} max={METRIC_META[key].max} step={METRIC_META[key].step} value={formData[key]} onChange={(event) => updateField(key, event.target.value)} placeholder={METRIC_META[key].placeholder} className={`w-full rounded-2xl border px-4 py-3 pr-16 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600 ${formData[key] === "" ? "border-slate-300" : metricErrors[key] ? "border-red-300" : "border-green-300"}`} />
                                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-slate-400">{METRIC_META[key].unit}</span>
                                </div>
                                <p className="mt-2 text-xs text-slate-400">{METRIC_META[key].helper}</p>
                                {metricErrors[key] ? <p className="mt-2 text-xs text-red-600">{metricErrors[key]}</p> : null}
                              </label>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">{completedMetricCount} of 7 fields complete</div>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setWizardStep(1)} className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">Back</button>
                      <button type="button" disabled={!step2Valid} title={!step2Valid ? "Please complete all fields above" : ""} onClick={() => completeAndGo(2, 3)} className={`rounded-2xl px-5 py-3 text-sm font-semibold text-white ${step2Valid ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300"}`}>
                        Next: Review Score -&gt;
                      </button>
                    </div>
                  </div>
                </section>

                <section className="w-1/4 flex-none px-8 py-8">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Step 3</p>
                  <h2 className="mt-3 text-2xl font-semibold text-slate-900">Supplier Score: {formData.name || "Supplier"}</h2>
                  <p className="mt-2 text-[15px] text-slate-500">{formData.period || "Scoring period"} - Calculated from 7 metrics</p>
                  <div className="mt-6 rounded-[24px] border p-8" style={{ backgroundColor: band.light, borderColor: band.border }}>
                    <div className="grid gap-6 lg:grid-cols-3">
                      <div className="flex items-center justify-center"><div className="flex h-[120px] w-[120px] items-center justify-center rounded-full border-4 bg-white" style={{ borderColor: band.color }}><div className="text-center"><div className="text-4xl font-bold" style={{ color: band.color }}>{animatedScore.toFixed(1)}</div><div className="text-sm text-slate-500">/100</div></div></div></div>
                      <div><div className="text-xl font-semibold" style={{ color: band.color }}>{band.label}</div><p className="mt-2 text-sm italic text-slate-600">{BAND_DESCRIPTIONS[band.tag]}</p></div>
                      <div><div className="text-sm text-slate-600">Calculated: {new Date().toLocaleString()}</div><div className="mt-3 flex h-3 overflow-hidden rounded-full bg-white">{(Object.keys(weights) as MetricKey[]).map((key) => <div key={key} style={{ width: `${weights[key]}%`, backgroundColor: WEIGHT_COLORS[key] }} />)}</div></div>
                    </div>
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
                    <h3 className="text-lg font-semibold text-slate-900">Performance Profile</h3>
                    <div className="mt-4 h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData}>
                          <PolarGrid stroke="#e2e8f0" />
                          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: "#64748b" }} />
                          <PolarRadiusAxis domain={[0, 100]} tickCount={5} tick={{ fontSize: 10 }} />
                          <Radar dataKey="score" stroke={band.color} fill={band.color} fillOpacity={0.15} strokeWidth={2} isAnimationActive animationDuration={400} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white">
                    <button type="button" onClick={() => setBreakdownOpen((current) => !current)} className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold text-slate-900">
                      <span>{breakdownOpen ? "Hide full score breakdown" : "See full score breakdown"}</span>
                    </button>
                    {breakdownOpen ? (
                      <div className="overflow-x-auto border-t border-slate-200 px-5 py-5">
                        <table className="min-w-full text-sm">
                          <thead className="text-left text-slate-500">
                            <tr>
                              <th className="pb-3">Metric</th>
                              <th className="pb-3">Your Value</th>
                              <th className="pb-3">Score</th>
                              <th className="pb-3">Weight</th>
                              <th className="pb-3">Contribution</th>
                            </tr>
                          </thead>
                          <tbody>
                            {metricRows.map((row) => (
                              <tr key={row.key} className="border-t border-slate-100">
                                <td className="py-3 font-medium text-slate-800">{row.label}</td>
                                <td className="py-3 text-slate-600">{formatMetricValue(row.key, row.raw)}</td>
                                <td className="py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200">
                                      <div className="h-full rounded-full" style={{ width: `${row.normalized}%`, backgroundColor: WEIGHT_COLORS[row.key] }} />
                                    </div>
                                    <span className="text-slate-700">{row.normalized.toFixed(0)}/100</span>
                                  </div>
                                </td>
                                <td className="py-3 text-slate-700">{row.weight}%</td>
                                <td className={`py-3 font-semibold ${row.key === highestMetric.key ? "text-slate-900" : "text-slate-700"}`}>{row.contribution.toFixed(1)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-slate-200">
                              <td className="pt-4 font-semibold text-slate-900">OVERALL</td>
                              <td className="pt-4 text-slate-500">-</td>
                              <td className="pt-4 text-slate-500">-</td>
                              <td className="pt-4 font-semibold text-slate-900">100%</td>
                              <td className="pt-4 text-lg font-semibold" style={{ color: band.color }}>{score.toFixed(1)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border-l-4 border-amber-600 bg-amber-50 p-5">
                      <div className="text-sm font-semibold text-amber-800">Biggest Improvement Opportunity</div>
                      <div className="mt-2 text-base font-semibold text-slate-900">{lowestMetric.label}: {lowestMetric.normalized.toFixed(0)}/100</div>
                      <p className="mt-2 text-sm text-slate-600">{METRIC_SUGGESTIONS[lowestMetric.key]}</p>
                    </div>
                    <div className="rounded-2xl border-l-4 border-green-600 bg-green-50 p-5">
                      <div className="text-sm font-semibold text-green-800">Top Strength</div>
                      <div className="mt-2 text-base font-semibold text-slate-900">{highestMetric.label}: {highestMetric.normalized.toFixed(0)}/100</div>
                      <p className="mt-2 text-sm text-slate-600">This is a reliable area - leverage in contract negotiations.</p>
                    </div>
                  </div>
                  <div className="mt-6">
                    <WeightPanel weights={weights} setWeights={setWeights} open={weightPanelOpen} setOpen={setWeightPanelOpen} />
                  </div>
                  <div className="mt-8 flex justify-between gap-3">
                    <button type="button" onClick={() => setWizardStep(2)} className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">Back</button>
                    <button type="button" onClick={() => completeAndGo(3, 4)} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">Next: Export & Share -&gt;</button>
                  </div>
                </section>

                <section className="w-1/4 flex-none px-8 py-8">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Step 4</p>
                  <h2 className="mt-3 text-2xl font-semibold text-slate-900">Your Scorecard is Ready</h2>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
                    Supplier: <span className="font-semibold text-slate-900">{formData.name}</span> - Period: <span className="font-semibold text-slate-900">{formData.period}</span> - Score: <span className="font-semibold text-slate-900">{score.toFixed(1)}/100</span>
                  </div>
                  <div ref={exportCardRef} className="mt-6 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div><div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Presentation Scorecard</div><h3 className="mt-2 text-xl font-semibold text-slate-900">{formData.name}</h3><p className="mt-1 text-sm text-slate-500">{formData.period}</p></div>
                      <div className="rounded-full px-4 py-2 text-sm font-semibold" style={{ backgroundColor: band.light, color: band.color }}>{band.label}</div>
                    </div>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {metricRows.map((row) => <div key={row.key} className="rounded-2xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{row.key}</div><div className="mt-2 text-base font-semibold text-slate-900">{row.normalized.toFixed(0)}/100</div><div className="mt-1 text-sm text-slate-500">{formatMetricValue(row.key, row.raw)}</div></div>)}
                    </div>
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="text-lg font-semibold text-slate-900">AI Summary</div>
                    <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Enter Anthropic API key" className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600" />
                    <button type="button" onClick={generateAiSummary} disabled={aiLoading} className={`mt-4 w-full rounded-2xl px-5 py-4 text-sm font-semibold text-white ${aiLoading ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"}`}>{aiLoading ? "Analyzing 7 performance metrics..." : "Generate Analysis"}</button>
                    {aiError ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{aiError}</div> : null}
                    {aiSummary ? <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-5"><p className="italic text-slate-700">{aiSummary}</p><p className="mt-3 text-xs text-slate-400">Generated by Claude AI - For internal use only</p><div className="mt-4 flex gap-3"><button type="button" onClick={generateAiSummary} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Regenerate</button><button type="button" onClick={copyAiSummary} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{copiedSummary ? "✓ Copied!" : "Copy to Clipboard"}</button></div></div> : null}
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="text-lg font-semibold text-slate-900">PNG</div><p className="mt-2 text-sm text-slate-500">Download a clean shareable image.</p><button type="button" onClick={handlePngDownload} className="mt-4 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white">Download PNG</button></div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="text-lg font-semibold text-slate-900">CSV</div><p className="mt-2 text-sm text-slate-500">Export score data as a spreadsheet.</p><button type="button" onClick={handleSingleCsvDownload} className="mt-4 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Download CSV</button></div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="text-lg font-semibold text-slate-900">Copy Table</div><p className="mt-2 text-sm text-slate-500">Paste into email or Teams.</p><button type="button" onClick={copySingleTable} className="mt-4 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">{copiedTable ? "✓ Copied!" : "Copy Table"}</button></div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="text-lg font-semibold text-slate-900">New Scorecard</div><p className="mt-2 text-sm text-slate-500">Start over for another supplier.</p><button type="button" onClick={resetSingle} className="mt-4 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">New Scorecard</button></div>
                  </div>
                  <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">Scorecard complete for {formData.name || "this supplier"}. No data was saved - download your results before closing this window.</div>
                </section>
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-6 space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Batch workflow</div>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Score Multiple Suppliers at Once</h2>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  <div>Upload</div><div>Review</div><div>Export</div>
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                <p>First row must be the header.</p>
                <p>Required columns: Supplier, Period, OTD, QA, SCAR, LTV, CV, RESP, DOC.</p>
                <p>One supplier per row, comma separated.</p>
              </div>
              <div className="mt-5 rounded-2xl bg-slate-900 p-4 font-mono text-sm text-slate-100">Supplier,Period,OTD,QA,SCAR,LTV,CV,RESP,DOC<br />Acme Aerospace,Q2 2025,87,96.5,3,4.2,2.1,3,91</div>
              <textarea rows={14} value={batchCSV} onChange={(event) => setBatchCSV(event.target.value)} placeholder="Paste your CSV data here..." className="mt-5 w-full rounded-2xl border border-slate-300 px-4 py-4 font-mono text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600" />
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={handleBatchScore} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white">Score All Suppliers</button>
                <button type="button" onClick={() => setBatchCSV(SAMPLE_CSV)} className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">Load Sample Data</button>
                <button type="button" onClick={resetBatch} className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">Clear</button>
              </div>
              {batchError ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{batchError}</div> : null}
            </div>
            {batchResults.length ? (
              <>
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap gap-3">
                    <div className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Total: {batchStats.total}</div>
                    <div className="rounded-full bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">Preferred: {batchStats.preferred}</div>
                    <div className="rounded-full bg-lime-50 px-3 py-2 text-sm font-semibold text-lime-700">Approved: {batchStats.approved}</div>
                    <div className="rounded-full bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">Conditional: {batchStats.conditional}</div>
                    <div className="rounded-full bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">At Risk: {batchStats.atRisk}</div>
                  </div>
                  <div className="mt-5"><WeightPanel weights={weights} setWeights={setWeights} open={batchWeightPanelOpen} setOpen={setBatchWeightPanelOpen} compactTrigger="Adjust scoring weights" /></div>
                  <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
                    <div className="overflow-x-auto rounded-2xl border border-slate-200">
                      <table className="min-w-[960px] text-sm">
                        <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3 text-left">#</th><th className="px-4 py-3 text-left">Supplier</th><th className="px-4 py-3 text-left">Period</th><th className="px-4 py-3 text-right">Score</th><th className="px-4 py-3 text-left">Band</th><th className="px-4 py-3 text-right">OTD</th><th className="px-4 py-3 text-right">QA</th><th className="px-4 py-3 text-right">SCAR</th><th className="px-4 py-3 text-right">LTV</th><th className="px-4 py-3 text-right">CV</th><th className="px-4 py-3 text-right">RESP</th><th className="px-4 py-3 text-right">DOC</th></tr></thead>
                        <tbody>
                          {batchResults.map((row, index) => (
                            <tr key={`${row.Supplier}-${row.Period}-${index}`} className="border-t border-slate-100" style={{ backgroundColor: row.band.light }}>
                              <td className="px-4 py-3 font-semibold">{index + 1}</td><td className="px-4 py-3 font-semibold">{row.Supplier}</td><td className="px-4 py-3">{row.Period}</td><td className="px-4 py-3 text-right font-bold" style={{ color: row.band.color }}>{row.score.toFixed(1)}</td><td className="px-4 py-3">{row.band.tag}</td><td className="px-4 py-3 text-right">{row.OTD}</td><td className="px-4 py-3 text-right">{row.QA}</td><td className="px-4 py-3 text-right">{row.SCAR}</td><td className="px-4 py-3 text-right">{row.LTV}</td><td className="px-4 py-3 text-right">{row.CV}</td><td className="px-4 py-3 text-right">{row.RESP}</td><td className="px-4 py-3 text-right">{row.DOC}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="text-sm font-semibold text-slate-900">Batch Score Comparison</div>
                      <div className="mt-4 h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={batchChartData}><XAxis dataKey="name" hide /><YAxis domain={[0, 100]} /><Tooltip /><Bar dataKey="score" radius={[8, 8, 0, 0]}>{batchChartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Bar></BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="sticky bottom-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-lg">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm font-semibold text-green-700">{batchResults.length} suppliers scored</div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={exportBatchCsv} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white">Export CSV</button>
                      <button type="button" onClick={copyBatchTable} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">{copiedBatchTable ? "✓ Copied!" : "Copy Table"}</button>
                      <button type="button" onClick={resetBatch} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700">Score New Batch</button>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        )}
      </div>
      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-sm text-slate-500">
        For internal review use only. Not a substitute for formal supplier audits per ISO 9001 or NQA-1. No data is saved or transmitted except for optional AI analysis via Anthropic API.
      </footer>
    </main>
  )
}

export default App
