import { useEffect, useMemo, useRef, useState } from "react"
import html2canvas from "html2canvas"
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts"

type MetricKey =
  | "onTimeDelivery"
  | "qualityAcceptance"
  | "scarCount"
  | "leadTimeVariance"
  | "costVariance"
  | "responsiveness"
  | "documentationCompliance"

type SupplierInput = {
  supplierName: string
  onTimeDelivery: number
  qualityAcceptance: number
  scarCount: number
  leadTimeVariance: number
  costVariance: number
  responsiveness: number
  documentationCompliance: number
}

type Weights = Record<MetricKey, number>

type MetricDefinition = {
  key: MetricKey
  label: string
  shortLabel: string
  helper: string
  step: number
  min?: number
  max?: number
  format?: (value: number) => string
}

type RatingBand = {
  label: string
  tone: string
  badgeClass: string
  rowClass: string
}

type BatchResult = {
  supplierName: string
  compositeScore: number
  rating: RatingBand
  normalizedScores: Record<MetricKey, number>
}

type ThemePreset = {
  id: string
  name: string
  description: string
  heroBackground: string
  heroRing: string
  accentButton: string
  accentText: string
}

type SavedSnapshot = {
  id: number
  supplierName: string
  compositeScore: number
  ratingLabel: string
  createdAt: string
  payload: {
    supplier: SupplierInput
    weights: Weights
  }
}

const defaultSupplier: SupplierInput = {
  supplierName: "ABC Precision Machining",
  onTimeDelivery: 87,
  qualityAcceptance: 96.5,
  scarCount: 2,
  leadTimeVariance: 4.2,
  costVariance: 2.1,
  responsiveness: 3,
  documentationCompliance: 91,
}

const defaultWeights: Weights = {
  onTimeDelivery: 30,
  qualityAcceptance: 25,
  scarCount: 15,
  leadTimeVariance: 10,
  costVariance: 10,
  responsiveness: 5,
  documentationCompliance: 5,
}

const metricDefinitions: MetricDefinition[] = [
  {
    key: "onTimeDelivery",
    label: "On-Time Delivery %",
    shortLabel: "OTD",
    helper: "Percent of deliveries received on or before the committed date.",
    step: 0.1,
    min: 0,
    max: 100,
    format: (value) => `${value.toFixed(1)}%`,
  },
  {
    key: "qualityAcceptance",
    label: "Quality Acceptance Rate %",
    shortLabel: "Quality",
    helper: "Percent of received lots accepted without quality rejection.",
    step: 0.1,
    min: 0,
    max: 100,
    format: (value) => `${value.toFixed(1)}%`,
  },
  {
    key: "scarCount",
    label: "SCAR Count",
    shortLabel: "SCAR",
    helper: "Supplier Corrective Action Requests issued during the review period.",
    step: 1,
    min: 0,
    format: (value) => value.toFixed(1),
  },
  {
    key: "leadTimeVariance",
    label: "Lead Time Variance (days)",
    shortLabel: "Lead Time",
    helper: "Difference from promised lead time. Negative means early; positive means late.",
    step: 0.1,
    format: (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}d`,
  },
  {
    key: "costVariance",
    label: "Cost Variance %",
    shortLabel: "Cost",
    helper: "Deviation from quoted or expected cost. Negative is favorable, positive is unfavorable.",
    step: 0.1,
    format: (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`,
  },
  {
    key: "responsiveness",
    label: "Responsiveness Score (1-5)",
    shortLabel: "Response",
    helper: "Internal team assessment of supplier communication speed and issue follow-through.",
    step: 0.1,
    min: 1,
    max: 5,
    format: (value) => value.toFixed(1),
  },
  {
    key: "documentationCompliance",
    label: "Documentation Compliance %",
    shortLabel: "Docs",
    helper: "Percent of required certifications, records, and delivery documents received correctly.",
    step: 0.1,
    min: 0,
    max: 100,
    format: (value) => `${value.toFixed(1)}%`,
  },
]

const csvHeaders = [
  "Supplier Name",
  "On-Time Delivery %",
  "Quality Acceptance Rate %",
  "SCAR Count",
  "Lead Time Variance (days)",
  "Cost Variance %",
  "Responsiveness Score (1-5)",
  "Documentation Compliance %",
]

const metricHeaderMap: Record<string, MetricKey | "supplierName"> = {
  "supplier name": "supplierName",
  "on-time delivery %": "onTimeDelivery",
  "quality acceptance rate %": "qualityAcceptance",
  "scar count": "scarCount",
  "lead time variance (days)": "leadTimeVariance",
  "cost variance %": "costVariance",
  "responsiveness score (1-5)": "responsiveness",
  "documentation compliance %": "documentationCompliance",
}

const themePresets: ThemePreset[] = [
  {
    id: "cw-command",
    name: "CW Command",
    description: "Blue-gray executive dashboard with a defense-program review tone.",
    heroBackground:
      "radial-gradient(circle at top left, rgba(59,130,246,0.18), transparent 35%), linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.93))",
    heroRing: "border-slate-200/70 dark:border-slate-700/70",
    accentButton: "bg-sky-600 hover:bg-sky-700",
    accentText: "text-sky-700",
  },
  {
    id: "factory-ops",
    name: "Factory Ops",
    description: "Steel, teal, and graphite styling for plant-floor supply reviews.",
    heroBackground:
      "radial-gradient(circle at top left, rgba(20,184,166,0.22), transparent 38%), linear-gradient(135deg, rgba(8,47,73,0.98), rgba(17,94,89,0.9))",
    heroRing: "border-cyan-200/60 dark:border-cyan-700/60",
    accentButton: "bg-teal-600 hover:bg-teal-700",
    accentText: "text-teal-700",
  },
  {
    id: "risk-watch",
    name: "Risk Watch",
    description: "Warmer review theme for escalation, risk meetings, and recovery plans.",
    heroBackground:
      "radial-gradient(circle at top left, rgba(251,146,60,0.20), transparent 38%), linear-gradient(135deg, rgba(69,26,3,0.98), rgba(120,53,15,0.92))",
    heroRing: "border-amber-200/60 dark:border-amber-700/60",
    accentButton: "bg-amber-600 hover:bg-amber-700",
    accentText: "text-amber-700",
  },
]

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

function interpolateDescending(
  absoluteValue: number,
  points: Array<{ x: number; y: number }>
) {
  if (absoluteValue <= points[0].x) {
    return points[0].y
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]

    if (absoluteValue <= next.x) {
      const ratio = (absoluteValue - current.x) / (next.x - current.x)
      return current.y + ratio * (next.y - current.y)
    }
  }

  return points[points.length - 1].y
}

function normalizeMetric(metric: MetricKey, value: number) {
  switch (metric) {
    case "onTimeDelivery":
    case "qualityAcceptance":
    case "documentationCompliance":
      return clamp(value)
    case "scarCount":
      return clamp(100 - clamp(value, 0, 5) * 20)
    case "leadTimeVariance":
      return clamp(
        interpolateDescending(Math.abs(value), [
          { x: 0, y: 100 },
          { x: 1, y: 90 },
          { x: 5, y: 50 },
          { x: 10, y: 0 },
        ])
      )
    case "costVariance":
      return clamp(
        interpolateDescending(Math.abs(value), [
          { x: 0, y: 100 },
          { x: 2, y: 80 },
          { x: 5, y: 50 },
          { x: 10, y: 0 },
        ])
      )
    case "responsiveness":
      return clamp((clamp(value, 1, 5) / 5) * 100)
    default:
      return 0
  }
}

function getNormalizedScores(input: SupplierInput) {
  return metricDefinitions.reduce(
    (scores, metric) => {
      scores[metric.key] = roundToOne(normalizeMetric(metric.key, input[metric.key]))
      return scores
    },
    {} as Record<MetricKey, number>
  )
}

function getCompositeScore(scores: Record<MetricKey, number>, weights: Weights) {
  const weightedTotal = metricDefinitions.reduce((sum, metric) => {
    return sum + scores[metric.key] * (weights[metric.key] / 100)
  }, 0)

  return roundToOne(weightedTotal)
}

function getRatingBand(score: number): RatingBand {
  if (score >= 90) {
    return {
      label: "Preferred Supplier",
      tone: "Green",
      badgeClass:
        "bg-emerald-500/15 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300 dark:ring-emerald-400/30",
      rowClass: "bg-emerald-50/70 dark:bg-emerald-950/20",
    }
  }

  if (score >= 75) {
    return {
      label: "Approved Supplier",
      tone: "Yellow-Green",
      badgeClass:
        "bg-lime-500/15 text-lime-700 ring-1 ring-inset ring-lime-500/30 dark:text-lime-300 dark:ring-lime-400/30",
      rowClass: "bg-lime-50/70 dark:bg-lime-950/20",
    }
  }

  if (score >= 60) {
    return {
      label: "Conditional",
      tone: "Yellow",
      badgeClass:
        "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300 dark:ring-amber-400/30",
      rowClass: "bg-amber-50/70 dark:bg-amber-950/20",
    }
  }

  return {
    label: "At Risk",
    tone: "Red",
    badgeClass:
      "bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:text-rose-300 dark:ring-rose-400/30",
    rowClass: "bg-rose-50/70 dark:bg-rose-950/20",
  }
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const escaped = String(cell ?? "").replace(/"/g, '""')
          return `"${escaped}"`
        })
        .join(",")
    )
    .join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ""
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (character === "," && !inQuotes) {
      values.push(current.trim())
      current = ""
      continue
    }

    current += character
  }

  values.push(current.trim())
  return values
}

function parseBatchCsv(csvText: string) {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    throw new Error("Paste a CSV with headers and at least one supplier row.")
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase())
  const mappedHeaders: Array<MetricKey | "supplierName" | null> = headers.map(
    (header) => metricHeaderMap[header] ?? null
  )

  if (mappedHeaders.includes(null)) {
    throw new Error("CSV headers must match the provided sample format exactly.")
  }

  const parsedRows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line)
    const base: Partial<SupplierInput> = {}

    mappedHeaders.forEach((mappedHeader, headerIndex) => {
      const rawValue = values[headerIndex]

      if (mappedHeader === null) {
        return
      }

      if (mappedHeader === "supplierName") {
        base.supplierName = rawValue || `Supplier ${index + 1}`
        return
      }

      const numericValue = Number(rawValue)

      if (Number.isNaN(numericValue)) {
        throw new Error(`Row ${index + 2} contains an invalid number for "${headers[headerIndex]}".`)
      }

      base[mappedHeader] = numericValue
    })

    return {
      supplierName: base.supplierName || `Supplier ${index + 1}`,
      onTimeDelivery: base.onTimeDelivery ?? 0,
      qualityAcceptance: base.qualityAcceptance ?? 0,
      scarCount: base.scarCount ?? 0,
      leadTimeVariance: base.leadTimeVariance ?? 0,
      costVariance: base.costVariance ?? 0,
      responsiveness: base.responsiveness ?? 1,
      documentationCompliance: base.documentationCompliance ?? 0,
    } satisfies SupplierInput
  })

  return parsedRows
}

function buildBalancedWeights(current: Weights, key: MetricKey, nextValue: number) {
  const sanitized = clamp(nextValue, 0, 100)
  const otherKeys = metricDefinitions.map((metric) => metric.key).filter((metricKey) => metricKey !== key)
  const otherTotal = otherKeys.reduce((sum, metricKey) => sum + current[metricKey], 0)
  const targetOtherTotal = 100 - sanitized
  const nextWeights = { ...current, [key]: sanitized }

  if (otherKeys.length === 0) {
    return nextWeights
  }

  if (otherTotal <= 0) {
    const evenShare = targetOtherTotal / otherKeys.length
    otherKeys.forEach((metricKey) => {
      nextWeights[metricKey] = evenShare
    })
  } else {
    otherKeys.forEach((metricKey) => {
      nextWeights[metricKey] = (current[metricKey] / otherTotal) * targetOtherTotal
    })
  }

  const roundedWeights = { ...nextWeights }
  const roundedKeys = metricDefinitions.map((metric) => metric.key)
  roundedKeys.forEach((metricKey) => {
    roundedWeights[metricKey] = roundToOne(roundedWeights[metricKey])
  })

  const roundedSum = roundToOne(
    roundedKeys.reduce((sum, metricKey) => sum + roundedWeights[metricKey], 0)
  )
  const difference = roundToOne(100 - roundedSum)
  const correctionKey = otherKeys[0] ?? key
  roundedWeights[correctionKey] = roundToOne(roundedWeights[correctionKey] + difference)

  return roundedWeights
}

function formatSnapshotDate(value: string) {
  return new Date(value).toLocaleString()
}

export default function Home() {
  const dashboardRef = useRef<HTMLElement>(null)
  const [supplier, setSupplier] = useState<SupplierInput>(defaultSupplier)
  const [weights, setWeights] = useState<Weights>(defaultWeights)
  const [batchCsv, setBatchCsv] = useState(
    [
      csvHeaders.join(","),
      "ABC Precision Machining,87,96.5,2,4.2,2.1,3,91",
      "Liberty Defense Systems,95,98.8,0,0.6,-0.5,4.8,97",
      "Falcon Components,72,89.4,4,7.5,6.2,2.7,83",
    ].join("\n")
  )
  const [batchResults, setBatchResults] = useState<BatchResult[]>([])
  const [batchError, setBatchError] = useState("")
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc")
  const [apiKey, setApiKey] = useState("")
  const [selectedThemeId, setSelectedThemeId] = useState("cw-command")
  const [savedSnapshots, setSavedSnapshots] = useState<SavedSnapshot[]>([])
  const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking")
  const [saveMessage, setSaveMessage] = useState("")

  const normalizedScores = useMemo(() => getNormalizedScores(supplier), [supplier])
  const compositeScore = useMemo(
    () => getCompositeScore(normalizedScores, weights),
    [normalizedScores, weights]
  )
  const ratingBand = useMemo(() => getRatingBand(compositeScore), [compositeScore])
  const weightSum = useMemo(
    () => roundToOne(metricDefinitions.reduce((sum, metric) => sum + weights[metric.key], 0)),
    [weights]
  )
  const improvementMetric = useMemo(() => {
    return metricDefinitions.reduce((lowest, metric) => {
      if (!lowest || normalizedScores[metric.key] < normalizedScores[lowest.key]) {
        return metric
      }
      return lowest
    }, metricDefinitions[0])
  }, [normalizedScores])

  const radarData = useMemo(
    () =>
      metricDefinitions.map((metric) => ({
        metric: metric.shortLabel,
        score: normalizedScores[metric.key],
        fullMark: 100,
      })),
    [normalizedScores]
  )

  const sortedBatchResults = useMemo(() => {
    return [...batchResults].sort((left, right) =>
      sortDirection === "desc"
        ? right.compositeScore - left.compositeScore
        : left.compositeScore - right.compositeScore
    )
  }, [batchResults, sortDirection])

  const selectedTheme = useMemo(
    () => themePresets.find((theme) => theme.id === selectedThemeId) ?? themePresets[0],
    [selectedThemeId]
  )

  useEffect(() => {
    async function loadServerData() {
      try {
        const [healthResponse, snapshotsResponse, themeResponse] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/snapshots"),
          fetch("/api/theme"),
        ])

        if (!healthResponse.ok || !snapshotsResponse.ok || !themeResponse.ok) {
          throw new Error("Local SQLite server is unavailable.")
        }

        const snapshots = (await snapshotsResponse.json()) as SavedSnapshot[]
        const theme = (await themeResponse.json()) as { themeId: string }

        setSavedSnapshots(snapshots)
        setSelectedThemeId(theme.themeId)
        setServerStatus("online")
      } catch {
        setServerStatus("offline")
      }
    }

    void loadServerData()
  }, [])

  function handleMetricChange(metric: MetricKey, rawValue: string) {
    const numericValue = Number(rawValue)
    setSupplier((current) => ({
      ...current,
      [metric]: Number.isNaN(numericValue) ? 0 : numericValue,
    }))
  }

  function handleWeightChange(metric: MetricKey, rawValue: string) {
    const numericValue = Number(rawValue)
    setWeights((current) => buildBalancedWeights(current, metric, Number.isNaN(numericValue) ? 0 : numericValue))
  }

  async function saveCurrentSnapshot() {
    try {
      const response = await fetch("/api/snapshots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supplierName: supplier.supplierName,
          compositeScore,
          ratingLabel: ratingBand.label,
          payload: {
            supplier,
            weights,
          },
        }),
      })

      if (!response.ok) {
        throw new Error("Snapshot save failed.")
      }

      const snapshotsResponse = await fetch("/api/snapshots")
      const snapshots = (await snapshotsResponse.json()) as SavedSnapshot[]
      setSavedSnapshots(snapshots)
      setServerStatus("online")
      setSaveMessage("Snapshot saved to SQLite.")
    } catch {
      setServerStatus("offline")
      setSaveMessage("SQLite server is unavailable. Start `npm run dev:server`.")
    }
  }

  async function deleteSnapshot(id: number) {
    try {
      await fetch(`/api/snapshots/${id}`, { method: "DELETE" })
      setSavedSnapshots((current) => current.filter((item) => item.id !== id))
    } catch {
      setSaveMessage("Could not delete snapshot.")
    }
  }

  function loadSnapshot(snapshot: SavedSnapshot) {
    setSupplier(snapshot.payload.supplier)
    setWeights(snapshot.payload.weights)
    setSaveMessage(`Loaded snapshot for ${snapshot.supplierName}.`)
  }

  async function selectTheme(themeId: string) {
    setSelectedThemeId(themeId)

    try {
      const response = await fetch("/api/theme", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ themeId }),
      })

      if (!response.ok) {
        throw new Error("Theme save failed.")
      }

      setServerStatus("online")
    } catch {
      setServerStatus("offline")
    }
  }

  function processBatch() {
    try {
      const parsedSuppliers = parseBatchCsv(batchCsv)
      const results = parsedSuppliers.map((item) => {
        const scores = getNormalizedScores(item)
        const score = getCompositeScore(scores, weights)

        return {
          supplierName: item.supplierName,
          compositeScore: score,
          rating: getRatingBand(score),
          normalizedScores: scores,
        }
      })

      setBatchResults(results)
      setBatchError("")
    } catch (error) {
      setBatchResults([])
      setBatchError(error instanceof Error ? error.message : "Unable to process the batch CSV.")
    }
  }

  function exportSingleSupplier() {
    const rows = [
      ["Supplier Name", supplier.supplierName],
      ["Composite Score", compositeScore.toFixed(1)],
      ["Rating", ratingBand.label],
      ["Weight Sum", weightSum.toFixed(1)],
      ["", "", "", ""],
      ["Metric", "Raw Input", "Normalized Score", "Weight %"],
      ...metricDefinitions.map((metric) => [
        metric.label,
        supplier[metric.key].toString(),
        normalizedScores[metric.key].toFixed(1),
        weights[metric.key].toFixed(1),
      ]),
    ]

    downloadCsv("cw-supplierscore-single.csv", rows)
  }

  function exportBatchResults() {
    if (!batchResults.length) {
      return
    }

    const rows = [
      [
        "Supplier Name",
        "Composite Score",
        "Rating",
        ...metricDefinitions.map((metric) => `${metric.shortLabel} Normalized`),
      ],
      ...sortedBatchResults.map((result) => [
        result.supplierName,
        result.compositeScore.toFixed(1),
        result.rating.label,
        ...metricDefinitions.map((metric) => result.normalizedScores[metric.key].toFixed(1)),
      ]),
    ]

    downloadCsv("cw-supplierscore-batch.csv", rows)
  }

  async function exportDashboardPng() {
    if (!dashboardRef.current) {
      return
    }

    const canvas = await html2canvas(dashboardRef.current, {
      backgroundColor: null,
      scale: 2,
    })
    const url = canvas.toDataURL("image/png")
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "cw-supplierscore-dashboard.png"
    anchor.click()
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-8 pb-10 sm:px-6 lg:px-8">
      <section
        className={`overflow-hidden rounded-[28px] border px-6 py-8 text-white shadow-2xl shadow-slate-900/10 sm:px-8 ${selectedTheme.heroRing}`}
        style={{ backgroundImage: selectedTheme.heroBackground }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100">
              Curtiss-Wright Internal Tool
            </span>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                CW SupplierScore
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
                Weighted supplier performance scoring for defense supply chain teams. Normalize seven
                operational metrics, apply configurable business weights, and standardize supplier
                reviews without spreadsheets.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <p className="text-slate-300">Score Model</p>
              <p className="mt-1 text-lg font-semibold">0-100 Weighted</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <p className="text-slate-300">Mode</p>
              <p className="mt-1 text-lg font-semibold">Single + Batch</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <p className="text-slate-300">Chart</p>
              <p className="mt-1 text-lg font-semibold">Radar Profile</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <p className="text-slate-300">SQLite</p>
              <p className="mt-1 text-lg font-semibold">
                {serverStatus === "online"
                  ? "Local Sync On"
                  : serverStatus === "offline"
                    ? "Server Offline"
                    : "Checking"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/30">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
                How To Use
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                Fast standardized supplier evaluation
              </h2>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100">
              Recalculates instantly on every change
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">1. Enter metrics</p>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Update the seven supplier inputs for a single supplier review.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">2. Tune weights</p>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Business weights auto-balance to remain exactly 100%.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">3. Share results</p>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Review the scorecard, process a batch CSV, or export the dashboard.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/30">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Themes And Local Save
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Presentation presets
          </h2>
          <div className="mt-5 space-y-3">
            {themePresets.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => void selectTheme(theme.id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  selectedThemeId === theme.id
                    ? "border-slate-900 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white"
                }`}
              >
                <div
                  className="mb-3 h-12 rounded-xl"
                  style={{ backgroundImage: theme.heroBackground }}
                />
                <p className="text-sm font-semibold">{theme.name}</p>
                <p className="mt-1 text-xs leading-5 opacity-80">{theme.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Local SQLite server</p>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Status: <span className="font-semibold">{serverStatus}</span>. Run <code>npm run dev:full</code> for the Vite app and SQLite API together.
            </p>
            {saveMessage ? (
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{saveMessage}</p>
            ) : null}
          </div>
          <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Claude API Key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Optional future integration"
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/30">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Single Supplier Mode
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                  Supplier metrics
                </h2>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                <span className="text-slate-500 dark:text-slate-400">Sample loaded:</span>{" "}
                <span className="font-semibold text-slate-900 dark:text-white">{defaultSupplier.supplierName}</span>
              </div>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Supplier Name
                </span>
                <input
                  type="text"
                  value={supplier.supplierName}
                  onChange={(event) =>
                    setSupplier((current) => ({ ...current, supplierName: event.target.value }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </label>

              {metricDefinitions.map((metric) => (
                <label key={metric.key}>
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                    {metric.label}
                    <span
                      tabIndex={0}
                      aria-label={metric.helper}
                      title={metric.helper}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      i
                    </span>
                  </span>
                  <input
                    type="number"
                    step={metric.step}
                    min={metric.min}
                    max={metric.max}
                    value={supplier[metric.key]}
                    onChange={(event) => handleMetricChange(metric.key, event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {metric.helper}
                  </p>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/30">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Weight Configuration
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                  Business weighting
                </h2>
              </div>
              <div
                className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                  weightSum === 100
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
                    : "bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50"
                }`}
              >
                Weight sum: {weightSum.toFixed(1)}%
              </div>
            </div>

            <div className="mt-6 space-y-5">
              {metricDefinitions.map((metric) => (
                <div key={metric.key} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {metric.shortLabel}
                        </p>
                        <span
                          tabIndex={0}
                          aria-label={`Weight for ${metric.label}. ${metric.helper}`}
                          title={`Weight for ${metric.label}. ${metric.helper}`}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                        >
                          i
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{metric.label}</p>
                    </div>
                    <div className="flex items-center gap-4 md:w-[320px]">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.1}
                        value={weights[metric.key]}
                        onChange={(event) => handleWeightChange(metric.key, event.target.value)}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-sky-600 dark:bg-slate-700"
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={weights[metric.key]}
                        onChange={(event) => handleWeightChange(metric.key, event.target.value)}
                        className="w-24 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setWeights(defaultWeights)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Reset To Defaults
              </button>
              <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                Changing one weight automatically redistributes the remaining percentage across the
                other factors so the total stays locked at 100%.
              </p>
            </div>
          </div>
        </section>

        <section ref={dashboardRef} className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/30">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-3">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Scorecard Dashboard
                </p>
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
                  {supplier.supplierName || "Current Supplier"}
                </h2>
                <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Composite score updates live as supplier metrics or weight assumptions change.
                </p>
              </div>
              <div className={`rounded-[28px] px-6 py-5 shadow-inner ${ratingBand.badgeClass}`}>
                <p className="text-sm font-semibold uppercase tracking-[0.18em]">{ratingBand.tone}</p>
                <p className="mt-3 text-5xl font-semibold tracking-tight">{compositeScore.toFixed(1)}</p>
                <p className="mt-2 text-sm font-medium">{ratingBand.label}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <p className="text-sm text-slate-500 dark:text-slate-400">Lowest normalized metric</p>
                <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  {improvementMetric.label}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {normalizedScores[improvementMetric.key].toFixed(1)} / 100
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <p className="text-sm text-slate-500 dark:text-slate-400">Highest weight</p>
                <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  {
                    metricDefinitions.reduce((highest, metric) =>
                      weights[metric.key] > weights[highest.key] ? metric : highest
                    ).label
                  }
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {
                    weights[
                      metricDefinitions.reduce((highest, metric) =>
                        weights[metric.key] > weights[highest.key] ? metric : highest
                      ).key
                    ]
                  .toFixed(1)}
                  %
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
                <p className="text-sm text-slate-500 dark:text-slate-400">Biggest improvement opportunity</p>
                <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  Focus on {improvementMetric.shortLabel}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  This category is currently the weakest normalized contributor to the composite score.
                </p>
              </div>
            </div>

            <div className="mt-6 h-[340px] rounded-3xl bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(241,245,249,0.7))] p-4 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.7))]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="rgba(100,116,139,0.35)" />
                  <PolarAngleAxis
                    dataKey="metric"
                    tick={{ fill: "currentColor", fontSize: 12 }}
                    className="text-slate-700 dark:text-slate-200"
                  />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar
                    name="Supplier Score"
                    dataKey="score"
                    stroke="#0f766e"
                    fill="#0ea5a4"
                    fillOpacity={0.42}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metricDefinitions.map((metric) => (
                <div
                  key={metric.key}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950/70"
                >
                  <p className="text-sm text-slate-500 dark:text-slate-400">{metric.shortLabel}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                    {normalizedScores[metric.key].toFixed(1)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Raw: {metric.format ? metric.format(supplier[metric.key]) : supplier[metric.key]}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void saveCurrentSnapshot()}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold text-white transition ${selectedTheme.accentButton}`}
              >
                Save To SQLite
              </button>
              <button
                type="button"
                onClick={exportSingleSupplier}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Export Current Result As CSV
              </button>
              <button
                type="button"
                onClick={exportDashboardPng}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Download Dashboard As PNG
              </button>
            </div>

            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Saved scorecards</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Stored locally in SQLite for recurring supplier reviews.
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                  {savedSnapshots.length} saved
                </span>
              </div>
              <div className="mt-4 grid gap-3">
                {savedSnapshots.length ? (
                  savedSnapshots.slice(0, 6).map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/70 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {snapshot.supplierName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Score {snapshot.compositeScore.toFixed(1)} · {snapshot.ratingLabel} · {formatSnapshotDate(snapshot.createdAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => loadSnapshot(snapshot)}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteSnapshot(snapshot.id)}
                          className="rounded-xl border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No saved scorecards yet. Save the current supplier once the SQLite server is running.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-slate-950/30">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Batch Mode
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              Ranked supplier comparison
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Paste CSV rows with the required headers, process the batch, and compare suppliers using
              the same active weight model.
            </p>
          </div>
          <button
            type="button"
            onClick={exportBatchResults}
            disabled={!batchResults.length}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Export Batch Results As CSV
          </button>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.2fr]">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              CSV Input
              <textarea
                value={batchCsv}
                onChange={(event) => setBatchCsv(event.target.value)}
                rows={14}
                className="mt-2 w-full rounded-3xl border border-slate-300 bg-white px-4 py-4 font-mono text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={processBatch}
                className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-sky-600 dark:hover:bg-sky-700"
              >
                Process Batch
              </button>
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                Headers must match the sample CSV format exactly.
              </p>
            </div>
            {batchError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
                {batchError}
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Supplier ranking</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click score to toggle sort order.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
                }
                className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Sort Score {sortDirection === "desc" ? "High-Low" : "Low-High"}
              </button>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="sticky top-0 bg-white/95 backdrop-blur dark:bg-slate-900/95">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Supplier Name
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Composite Score
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                      Rating
                    </th>
                    {metricDefinitions.map((metric) => (
                      <th
                        key={metric.key}
                        className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300"
                      >
                        {metric.shortLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {sortedBatchResults.length ? (
                    sortedBatchResults.map((result) => (
                      <tr key={result.supplierName} className={result.rating.rowClass}>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {result.supplierName}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900 dark:text-white">
                          {result.compositeScore.toFixed(1)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${result.rating.badgeClass}`}
                          >
                            {result.rating.label}
                          </span>
                        </td>
                        {metricDefinitions.map((metric) => (
                          <td
                            key={metric.key}
                            className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300"
                          >
                            {result.normalizedScores[metric.key].toFixed(1)}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={metricDefinitions.length + 3}
                        className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                      >
                        Process the batch CSV to populate the ranked table.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
