// ==============================
// グローバル変数
// ==============================
let rawData = [];

// Excel上の実際の列名（自動検出してセット）
let COL_TEAM = null;
let COL_POSITION = null;
let COL_SALARY = null;
let COL_NAME = null;

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
// 列名の自動検出
// ==============================
function detectColumns(data) {
  const first = data.find(row => Object.keys(row).length > 0);
  if (!first) return false;

  const keys = Object.keys(first);

  COL_TEAM     = keys.find(k => k.includes("チーム"));
  COL_POSITION = keys.find(k => k.includes("ポジション"));
  COL_SALARY   = keys.find(k => k.includes("年俸"));
  COL_NAME     = keys.find(k => k.includes("選手名")) || null;

  if (!COL_TEAM || !COL_POSITION || !COL_SALARY) {
    alert("「チーム」「ポジション」「年俸」を含む列が見つかりませんでした。列名を確認してください。");
    console.log("見つかった列名一覧:", keys);
    return false;
  }

  console.log("検出された列:", { COL_TEAM, COL_POSITION, COL_SALARY, COL_NAME });
  return true;
}

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
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = workbook.Sheets[firstSheetName];

      const json = XLSX.utils.sheet_to_json(firstSheet, { defval: null });

      rawData = json;

      if (!detectColumns(rawData)) {
        rawData = [];
        drawEmptyChart();
        document.getElementById("previewTableWrapper").innerHTML = "";
        document.getElementById("outlierTableWrapper").innerHTML = "";
        document.getElementById("outlierNote").textContent = "";
        return;
      }

      showPreviewTable(rawData);
      updateAnalysis();
    } catch (err) {
      console.error("読み込みエラー:", err);
      alert("Excel の読み込みでエラーが発生しました。ファイル形式や列名を確認してください。");
    }
  };

  reader.readAsArrayBuffer(file);
}

// ==============================
// 読み込んだデータ（全行表示）
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

  // ヘッダ
  const trHead = document.createElement("tr");
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  // ★ 全行を表示（スクロールはCSS側で制御）
  for (let i = 0; i < data.length; i++) {
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
// 分析更新
// ==============================
function updateAnalysis() {
  updateModeDescription();

  const groupBy = document.getElementById("groupBySelect").value;
  const filter = document.getElementById("filterSelect").value;

  if (!rawData || rawData.length === 0) {
    drawEmptyChart();
    updateOutlierTable(groupBy, filter);
    return;
  }

  drawBoxplot(groupBy, filter);
  updateOutlierTable(groupBy, filter);
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
// ==============================
function drawBoxplot(groupBy, filter) {
  try {
    const groupKeyName = groupBy === "team" ? COL_TEAM : COL_POSITION;

    // 1. 上位10名除外用セット
    let top10IndexSet = null;
    if (filter === "top10") {
      const salaryWithIndex = [];
      rawData.forEach((row, idx) => {
        const sal = parseSalary(row[COL_SALARY]);
        if (!isNaN(sal)) salaryWithIndex.push({ idx, salary: sal });
      });
      salaryWithIndex.sort((a, b) => b.salary - a.salary);
      const top10 = salaryWithIndex.slice(0, 10);
      top10IndexSet = new Set(top10.map(o => o.idx));
    }

    // 2. グループ化
    const groupMap = new Map();

    rawData.forEach((row, idx) => {
      const groupKey = row[groupKeyName];
      const sal = parseSalary(row[COL_SALARY]);
      if (!groupKey || isNaN(sal)) return;

      if (filter === "top10" && top10IndexSet && top10IndexSet.has(idx)) {
        return;
      }

      if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
      groupMap.get(groupKey).push(sal);
    });

    console.log("グループ数:", groupMap.size);

    // 3. 外れ値除外（IQR）
    const groupDataArray = [];
    groupMap.forEach((values, name) => {
      let arr = values.slice().sort((a, b) => a - b);

      if (filter === "group-outliers" && arr.length >= 4) {
        const q1 = quantile(arr, 0.25);
        const q3 = quantile(arr, 0.75);
        const iqr = q3 - q1;
        const lower = q1 - 1.5 * iqr;
        const upper = q3 + 1.5 * iqr;
        arr = arr.filter(v => v >= lower && v <= upper);
      }

      if (arr.length > 0) groupDataArray.push({ name, values: arr });
    });

    console.log("箱ひげ図に使うグループ:", groupDataArray.length);

    if (groupDataArray.length === 0) {
      drawEmptyChart();
      return;
    }

    // 中央値の高い順に並べ替え
    groupDataArray.sort((a, b) => median(b.values) - median(a.values));

    const traces = groupDataArray.map(d => ({
      y: d.values,
      type: "box",
      name: d.name,
      // ★箱の幅を太めに
      width: 0.8,
      // ★外れ値だけ点で表示（全部の点をバラバラ出さない）
      boxpoints: "outliers",
      hovertemplate:
        `${groupBy === "team" ? "チーム" : "ポジション"}: ${d.name}` +
        "<br>年俸: %{y} 万円<extra></extra>"
    }));

    const layout = {
      title:
        (groupBy === "team" ? "チーム別" : "ポジション別") +
        " 年俸分布（箱ひげ図）",
      xaxis: {
        title: groupBy === "team" ? "チーム" : "ポジション",
        tickangle: -45
      },
      yaxis: { title: "年俸（万円）" },
      // ★凡例を消す（右側のチーム名一覧）
      showlegend: false,
      // ★箱と箱の間隔（微調整用）
      boxgap: 0.2,
      boxgroupgap: 0.1,
      margin: { l: 60, r: 20, t: 60, b: 140 },
      boxmode: "group"
    };

    Plotly.newPlot("chart", traces, layout, { responsive: true });
  } catch (err) {
    console.error("箱ひげ図描画エラー:", err);
    alert("箱ひげ図の描画でエラーが発生しました。コンソールのエラーを確認してください。");
  }
}

// ==============================
// 外れ値 / 上位10名 一覧
// ==============================
function updateOutlierTable(groupBy, filter) {
  const note = document.getElementById("outlierNote");
  const wrapper = document.getElementById("outlierTableWrapper");
  wrapper.innerHTML = "";

  if (!rawData || rawData.length === 0) {
    note.textContent = "データが読み込まれていません。";
    return;
  }

  const unitText = groupBy === "team" ? "チーム" : "ポジション";
  const groupKeyName = groupBy === "team" ? COL_TEAM : COL_POSITION;

  if (filter === "none") {
    note.textContent =
      "外れ値の一覧は「各グループの外れ値を除外」または「上位10名を除外」を選んだときに表示されます。";
    return;
  }

  let list = [];

  if (filter === "group-outliers") {
    note.textContent =
      `各${unitText}の中で IQR 法により外れ値と判定された選手の一覧です。`;

    const groupMap = new Map();
    rawData.forEach((row, idx) => {
      const groupKey = row[groupKeyName];
      const sal = parseSalary(row[COL_SALARY]);
      if (!groupKey || isNaN(sal)) return;
      if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
      groupMap.get(groupKey).push({ idx, salary: sal });
    });

    groupMap.forEach((arr, groupKey) => {
      if (arr.length < 4) return;
      const salaries = arr.map(o => o.salary).sort((a, b) => a - b);
      const q1 = quantile(salaries, 0.25);
      const q3 = quantile(salaries, 0.75);
      const iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr;
      const upper = q3 + 1.5 * iqr;

      arr.forEach(o => {
        if (o.salary < lower || o.salary > upper) {
          const row = rawData[o.idx];
          list.push({
            groupKey,
            name: COL_NAME ? row[COL_NAME] : "",
            team: row[COL_TEAM],
            position: row[COL_POSITION],
            salary: o.salary
          });
        }
      });
    });
  } else if (filter === "top10") {
    note.textContent = "リーグ全体の年俸上位10名の一覧です。";

    const salaryWithIndex = [];
    rawData.forEach((row, idx) => {
      const sal = parseSalary(row[COL_SALARY]);
      if (!isNaN(sal)) salaryWithIndex.push({ idx, salary: sal });
    });
    salaryWithIndex.sort((a, b) => b.salary - a.salary);
    const top10 = salaryWithIndex.slice(0, 10);

    list = top10.map((o, rank) => {
      const row = rawData[o.idx];
      return {
        rank: rank + 1,
        name: COL_NAME ? row[COL_NAME] : "",
        team: row[COL_TEAM],
        position: row[COL_POSITION],
        salary: o.salary
      };
    });
  }

  if (list.length === 0) {
    wrapper.textContent = "該当するデータがありません。";
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headerRow = document.createElement("tr");

  let headers;
  if (filter === "top10") {
    headers = ["順位", "選手名", "チーム", "ポジション", "年俸（万円）"];
  } else {
    headers = [unitText, "選手名", "チーム", "ポジション", "年俸（万円）"];
  }

  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  list.forEach(item => {
    const tr = document.createElement("tr");
    if (filter === "top10") {
      addCell(tr, item.rank);
      addCell(tr, item.name);
      addCell(tr, item.team);
      addCell(tr, item.position);
      addCell(tr, item.salary);
    } else {
      addCell(tr, item.groupKey);
      addCell(tr, item.name);
      addCell(tr, item.team);
      addCell(tr, item.position);
      addCell(tr, item.salary);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  wrapper.appendChild(table);
}

function addCell(tr, text) {
  const td = document.createElement("td");
  td.textContent = text;
  tr.appendChild(td);
}

// ==============================
// ユーティリティ関数
// ==============================
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

function quantile(sortedArray, p) {
  const n = sortedArray.length;
  if (n === 0) return NaN;
  const index = (n - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedArray[lower];
  const weight = index - lower;
  return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
}

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
