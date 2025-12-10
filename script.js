// ==============================
// 列名の設定（Excelのヘッダと合わせる）
// ==============================
const TEAM_COL = "チーム";
const POSITION_COL = "ポジション";
const SALARY_COL = "年俸";

// 読み込んだ生データ
let rawData = [];

// ==============================
// 初期化
// ==============================
window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const groupBySelect = document.getElementById("groupBySelect");
  const filterSelect = document.getElementById("filterSelect");

  fileInput.addEventListener("change", handleFileSelect);
  groupBySelect.addEventListener("change", updateAnalysis);
  filterSelect.addEventListener("change", updateAnalysis);

  updateModeDescription();
  drawEmptyChart();
});

// ==============================
// 説明テキストの更新
// ==============================
function updateModeDescription() {
  const groupBy = document.getElementById("groupBySelect").value;
  const filter = document.getElementById("filterSelect").value;
  const desc = document.getElementById("modeDescription");

  const unitText = groupBy === "team" ? "チーム" : "ポジション";

  let text = `現在：${unitText}別に年俸を箱ひげ図で表示します。`;

  if (filter === "none") {
    text += " 外れ値を含めた全データを使います。";
  } else if (filter === "group-outliers") {
    text += ` 各${unitText}の中で四分位範囲（IQR）に基づき外れ値を除外して表示します。`;
  } else if (filter === "top10") {
    text += " リーグ全体の年俸上位10名を一度取り除いてから表示します。";
  }

  desc.textContent = text;
}

// ==============================
// ファイル選択 → Excel読み込み
// ==============================
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];

    // シート全体を JSON に変換
    const json = XLSX.utils.sheet_to_json(firstSheet, { defval: null });

    rawData = json;
    showPreviewTable(rawData);
    updateAnalysis();
  };

  reader.readAsArrayBuffer(file);
}

// ==============================
// データのプレビュー（先頭数行）
// ==============================
function showPreviewTable(data) {
  const wrapper = document.getElementById("previewTableWrapper");
  wrapper.innerHTML = "";

  if (!data || data.length === 0) {
    wrapper.textContent = "データが読み込まれていません。";
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const firstRow = data[0];
  const columns = Object.keys(firstRow);

  const trHead = document.createElement("tr");
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  const maxRows = Math.min(10, data.length);
  for (let i = 0; i < maxRows; i++) {
    const row = data[i];
    const tr = document.createElement("tr");
    columns.forEach(col => {
      const td = document.createElement("td");
      td.textContent = row[col];
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  wrapper.appendChild(table);
}

// ==============================
// 分析更新（グループ・フィルタの切替など）
// ==============================
function updateAnalysis() {
  updateModeDescription();

  if (!rawData || rawData.length === 0) {
    drawEmptyChart();
    return;
  }

  const groupBy = document.getElementById("groupBySelect").value; // "team" or "position"
  const filter = document.getElementById("filterSelect").value;   // "none" | "group-outliers" | "top10"

  drawBoxplot(groupBy, filter);
}

// ==============================
// 空のチャート
// ==============================
function drawEmptyChart() {
  const layout = {
    title: "データをアップロードするとここに箱ひげ図が表示されます",
    xaxis: { visible: false },
    yaxis: { visible: false },
    margin: { l: 40, r: 20, t: 60, b: 40 }
  };
  Plotly.newPlot("chart", [], layout, { responsive: true });
}

// ==============================
// 箱ひげ図の描画
// groupBy: "team" | "position"
// filter: "none" | "group-outliers" | "top10"
// ==============================
function drawBoxplot(groupBy, filter) {
  // 1. 上位10名除外のために、インデックス集合を作る
  let top10IndexSet = null;

  if (filter === "top10") {
    const salaryWithIndex = [];

    rawData.forEach((row, idx) => {
      let sal = parseSalary(row[SALARY_COL]);
      if (!isNaN(sal)) {
        salaryWithIndex.push({ idx: idx, salary: sal });
      }
    });

    salaryWithIndex.sort((a, b) => b.salary - a.salary); // 高い順
    const top10 = salaryWithIndex.slice(0, 10)
