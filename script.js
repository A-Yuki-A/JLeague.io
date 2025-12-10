// =====================================
// 列名の設定（Excelのヘッダと合わせる）
// =====================================
const TEAM_COL = "チーム";
const SALARY_COL = "年俸";

// 読み込んだ全データを保持
let rawData = [];

// =====================================
// 初期化
// =====================================
window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const modeSelect = document.getElementById("modeSelect");

  fileInput.addEventListener("change", handleFileSelect);
  modeSelect.addEventListener("change", updateAnalysis);

  updateModeDescription();
});

// =====================================
// 分析モードの説明テキスト更新
// =====================================
function updateModeDescription() {
  const mode = document.getElementById("modeSelect").value;
  const desc = document.getElementById("modeDescription");

  if (mode === "normal") {
    desc.textContent = "すべてのデータをそのまま使って、チームごとの年俸分布を箱ひげ図で表示します。";
  } else if (mode === "remove-team-outliers") {
    desc.textContent = "各チームごとに四分位範囲（IQR）を使って外れ値を除外し、チーム内の「典型的な」分布を見ます。";
  } else if (mode === "remove-top10") {
    desc.textContent = "全選手の中から年俸の高い上位10人を一度取り除き、残りの選手でチームごとの分布を比較します。";
  }
}

// =====================================
// ファイル選択 -> Excel読み込み
// =====================================
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];

    // シート全体をJSONに変換
    const json = XLSX.utils.sheet_to_json(firstSheet, { defval: null });

    rawData = json;
    showPreviewTable(rawData);
    updateAnalysis();
  };

  reader.readAsArrayBuffer(file);
}

// =====================================
// データのプレビュー（先頭数行）
// =====================================
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

  // ヘッダ行（オブジェクトのキーから）
  const firstRow = data[0];
  const columns = Object.keys(firstRow);

  const trHead = document.createElement("tr");
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  // 最初の10行だけ表示
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

// =====================================
// 分析の更新（モード変更やファイル読込時）
// =====================================
function updateAnalysis() {
  updateModeDescription();

  if (!rawData || rawData.length === 0) {
    drawEmptyChart();
    return;
  }

  const mode = document.getElementById("modeSelect").value;
  drawBoxplot(mode);
}

// =====================================
// 空のチャート（データ未読込時など）
// =====================================
function drawEmptyChart() {
  const layout = {
    title: "データをアップロードするとここに箱ひげ図が表示されます",
    xaxis: { visible: false },
    yaxis: { visible: false },
    margin: { l: 40, r: 20, t: 60, b: 40 }
  };
  Plotly.newPlot("chart", [], layout, { responsive: true });
}

// =====================================
// 箱ひげ図の描画
// mode: "normal" | "remove-team-outliers" | "remove-top10"
// =====================================
function drawBoxplot(mode) {
  // 1. 全体の上位10人を除外したい場合の準備
  let top10IndexSet = null;

  if (mode === "remove-top10") {
    const salaryWithIndex = [];

    rawData.forEach((row, idx) => {
      let sal = parseSalary(row[SALARY_COL]);
      if (!isNaN(sal)) {
        salaryWithIndex.push({ idx: idx, salary: sal });
      }
    });

    salaryWithIndex.sort((a, b) => b.salary - a.salary); // 高い順
    const top10 = salaryWithIndex.slice(0, 10);
    top10IndexSet = new Set(top10.map(obj => obj.idx));
  }

  // 2. チームごとに年俸データをグループ化
  const teamMap = new Map();

  rawData.forEach((row, idx) => {
    const team = row[TEAM_COL];
    let sal = parseSalary(row[SALARY_COL]);

    if (!team || isNaN(sal)) return;

    // 全体の上位10人を除外する場合
    if (mode === "remove-top10" && top10IndexSet && top10IndexSet.has(idx)) {
      return;
    }

    if (!teamMap.has(team)) {
      teamMap.set(team, []);
    }
    teamMap.get(team).push(sal);
  });

  // 3. チームごとに外れ値除去（必要なとき）
  const teamDataArray = []; // { team, salaries }

  teamMap.forEach((salaries, team) => {
    let filtered = salaries.slice().sort((a, b) => a - b);

    if (mode === "remove-team-outliers" && filtered.length >= 4) {
      const q1 = quantile(filtered, 0.25);
      const q3 = quantile(filtered, 0.75);
      const iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr;
      const upper = q3 + 1.5 * iqr;

      filtered = filtered.filter(v => v >= lower && v <= upper);
    }

    if (filtered.length > 0) {
      teamDataArray.push({ team, salaries: filtered });
    }
  });

  if (teamDataArray.length === 0) {
    drawEmptyChart();
    return;
  }

  // 4. チームを「中央値の高い順」に並べ替え（見やすくするため）
  teamDataArray.sort((a, b) => median(b.salaries) - median(a.salaries));

  // 5. Plotly のトレースを作成
  const traces = teamDataArray.map(d => ({
    y: d.salaries,
    type: "box",
    name: d.team,
    boxpoints: "all", // データ点も表示
    jitter: 0.3,
    pointpos: -1.5,
    hovertemplate: "チーム: " + d.team + "<br>年俸: %{y} 万円<extra></extra>"
  }));

  const layout = {
    title: "チームごとの年俸分布（箱ひげ図）",
    xaxis: {
      title: "チーム",
      tickangle: -45
    },
    yaxis: {
      title: "年俸（万円）"
    },
    margin: { l: 60, r: 20, t: 60, b: 140 },
    boxmode: "group"
  };

  Plotly.newPlot("chart", traces, layout, { responsive: true });
}

// =====================================
// ユーティリティ関数
// =====================================

// 年俸のセルを数値に変換（カンマや文字を消す）
function parseSalary(value) {
  if (value == null) return NaN;

  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").replace(/[^\d.]/g, "");
    const num = parseFloat(cleaned);
    return num;
  }
  return NaN;
}

// 分位数（0〜1）
function quantile(sortedArray, p) {
  const n = sortedArray.length;
  if (n === 0) return NaN;

  const index = (n - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedArray[lower];
  } else {
    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }
}

// 中央値
function median(arr) {
  if (!arr || arr.length === 0) return NaN;
  const sorted = arr.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);

  if (n % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}
