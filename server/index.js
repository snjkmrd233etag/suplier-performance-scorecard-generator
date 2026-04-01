const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const initSqlJs = require("sql.js")

const app = express()
const port = Number(process.env.PORT || 4000)
const dataDir = path.join(__dirname, "..", "data")
const dbPath = path.join(dataDir, "supplier-score.sqlite")

fs.mkdirSync(dataDir, { recursive: true })

app.use(cors())
app.use(express.json({ limit: "2mb" }))

let SQL
let db

function persistDatabase() {
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

function queryRows(statement, params = []) {
  const results = db.exec(statement, params)

  if (!results.length) {
    return []
  }

  const [{ columns, values }] = results
  return values.map((valueRow) =>
    columns.reduce((row, column, index) => {
      row[column] = valueRow[index]
      return row
    }, {})
  )
}

function runStatement(statement, params = []) {
  db.run(statement, params)
  persistDatabase()
}

async function initializeDatabase() {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
  })

  const dbBuffer = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined
  db = new SQL.Database(dbBuffer)

  db.run(`
    CREATE TABLE IF NOT EXISTS supplier_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      composite_score REAL NOT NULL,
      rating_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS theme_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      theme_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  persistDatabase()
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" })
})

app.get("/api/snapshots", (_request, response) => {
  const rows = queryRows(`
    SELECT id, supplier_name, payload, composite_score, rating_label, created_at
    FROM supplier_snapshots
    ORDER BY datetime(created_at) DESC, id DESC
  `).map((row) => ({
    id: Number(row.id),
    supplierName: row.supplier_name,
    compositeScore: Number(row.composite_score),
    ratingLabel: row.rating_label,
    createdAt: row.created_at,
    payload: JSON.parse(row.payload),
  }))

  response.json(rows)
})

app.post("/api/snapshots", (request, response) => {
  const { supplierName, compositeScore, ratingLabel, payload } = request.body ?? {}

  if (
    typeof supplierName !== "string" ||
    typeof compositeScore !== "number" ||
    typeof ratingLabel !== "string" ||
    !payload
  ) {
    response.status(400).json({ error: "Invalid snapshot payload." })
    return
  }

  runStatement(
    `
      INSERT INTO supplier_snapshots (supplier_name, payload, composite_score, rating_label)
      VALUES (?, ?, ?, ?)
    `,
    [supplierName, JSON.stringify(payload), compositeScore, ratingLabel]
  )

  const inserted = queryRows(`SELECT last_insert_rowid() AS id`)
  response.status(201).json({ id: Number(inserted[0].id) })
})

app.delete("/api/snapshots/:id", (request, response) => {
  const id = Number(request.params.id)

  if (Number.isNaN(id)) {
    response.status(400).json({ error: "Invalid snapshot id." })
    return
  }

  runStatement(`DELETE FROM supplier_snapshots WHERE id = ?`, [id])
  response.status(204).send()
})

app.get("/api/theme", (_request, response) => {
  const rows = queryRows(`SELECT theme_id FROM theme_preferences WHERE id = 1`)
  response.json({ themeId: rows[0]?.theme_id ?? "cw-command" })
})

app.post("/api/theme", (request, response) => {
  const { themeId } = request.body ?? {}

  if (typeof themeId !== "string" || !themeId.trim()) {
    response.status(400).json({ error: "Theme id is required." })
    return
  }

  runStatement(
    `
      INSERT INTO theme_preferences (id, theme_id, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        theme_id = excluded.theme_id,
        updated_at = CURRENT_TIMESTAMP
    `,
    [themeId]
  )

  response.status(204).send()
})

initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`SQLite API listening on http://localhost:${port}`)
    })
  })
  .catch((error) => {
    console.error("Failed to initialize SQLite server", error)
    process.exit(1)
  })
