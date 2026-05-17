/**
 * @OnlyCurrentDoc
 */
var SHEET_NAME = "Repositories";
var GITHUB_API_TEMPLATE =
  "https://api.github.com/users/{username}/repos?per_page=100&sort=updated";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("GitHub Monitor")
    .addItem("Обновить репозитории", "updateGitHubRepositories")
    .addItem("Очистить данные", "clearRepositoryData")
    .addToUi();
}

function updateGitHubRepositories() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(spreadsheet, SHEET_NAME);
  setupSheetLayout(sheet);

  try {
    var username = String(sheet.getRange("B1").getValue()).trim();
    if (!username) {
      writeStatus(sheet, "Ошибка: укажите GitHub username в ячейке B1.");
      return;
    }

    if (!validateGitHubUsername(username)) {
      writeStatus(
        sheet,
        "Ошибка: некорректный username. Допустимы 1-39 символов: латинские буквы, цифры и дефис. Username не должен начинаться или заканчиваться дефисом."
      );
      return;
    }

    var repositories = fetchGitHubRepositories(username);
    var normalizedRepositories = repositories.map(normalizeRepository);

    normalizedRepositories.sort(function (left, right) {
      return right.updatedAtMs - left.updatedAtMs;
    });

    writeRepositoriesToSheet(sheet, normalizedRepositories);
    writeSummaryToSheet(sheet, calculateSummary(normalizedRepositories));
    sheet.getRange("B4").setValue(new Date());

    if (normalizedRepositories.length === 0) {
      writeStatus(sheet, "У пользователя нет публичных репозиториев.");
      return;
    }

    writeStatus(
      sheet,
      "Успешно: загружено репозиториев — " + normalizedRepositories.length + "."
    );
  } catch (error) {
    writeStatus(sheet, "Ошибка: " + error.message);
  }
}

function clearRepositoryData() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(spreadsheet, SHEET_NAME);
  setupSheetLayout(sheet);

  var maxRows = sheet.getMaxRows();
  sheet.getRange(7, 1, maxRows - 6, 7).clearContent();
  sheet.getRange("I1:J5").clearContent();
  sheet.getRange("B4").setValue(new Date());
  writeStatus(sheet, "Данные очищены.");
}

function getOrCreateSheet(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

function setupSheetLayout(sheet) {
  sheet.getRange("A1").setValue("GitHub username");
  sheet.getRange("A3").setValue("Status");
  sheet.getRange("A4").setValue("Last update");
  sheet.getRange("A6:G6").setValues([
    ["Name", "Description", "Language", "Stars", "Forks", "Updated At", "URL"],
  ]);

  sheet.getRange("A6:G6").setFontWeight("bold");
  sheet.setFrozenRows(6);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 360);
  sheet.setColumnWidth(3, 140);
  sheet.setColumnWidth(4, 90);
  sheet.setColumnWidth(5, 90);
  sheet.setColumnWidth(6, 170);
  sheet.setColumnWidth(7, 360);

  sheet.getRange("B4").setNumberFormat("dd.MM.yyyy HH:mm");
}

function validateGitHubUsername(username) {
  if (username.length < 1 || username.length > 39) {
    return false;
  }

  if (!/^[A-Za-z0-9-]+$/.test(username)) {
    return false;
  }

  if (username.charAt(0) === "-" || username.charAt(username.length - 1) === "-") {
    return false;
  }

  return true;
}

function fetchGitHubRepositories(username) {
  var url = GITHUB_API_TEMPLATE.replace("{username}", encodeURIComponent(username));
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true,
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
  } catch (error) {
    throw new Error("не удалось обратиться к GitHub API. Проверьте сеть и повторите попытку.");
  }

  var statusCode = response.getResponseCode();
  var headers = response.getAllHeaders() || {};
  var remaining =
    headers["X-RateLimit-Remaining"] || headers["x-ratelimit-remaining"] || "";

  if (statusCode === 404) {
    throw new Error("пользователь не найден (HTTP 404).");
  }

  if (statusCode === 403 && String(remaining) === "0") {
    throw new Error("превышен лимит запросов GitHub API (HTTP 403).");
  }

  if (statusCode === 403) {
    throw new Error("доступ ограничен (HTTP 403). Возможно, временный rate limit.");
  }

  if (statusCode >= 500 && statusCode <= 599) {
    throw new Error("GitHub API временно недоступен.");
  }

  if (statusCode !== 200) {
    throw new Error("ошибка при обращении к GitHub API: HTTP " + statusCode + ".");
  }

  var data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error("ответ GitHub API не является корректным JSON.");
  }

  if (!Array.isArray(data)) {
    throw new Error("неожиданный формат ответа GitHub API.");
  }

  return data;
}

function normalizeRepository(repository) {
  var updatedAtRaw = typeof repository.updated_at === "string" ? repository.updated_at : "";
  var updatedAtMs = 0;
  if (updatedAtRaw) {
    var parsedTime = Date.parse(updatedAtRaw);
    updatedAtMs = Number.isNaN(parsedTime) ? 0 : parsedTime;
  }

  return {
    name: typeof repository.name === "string" ? repository.name : "",
    description:
      typeof repository.description === "string" && repository.description
        ? repository.description
        : "Описание отсутствует",
    language:
      typeof repository.language === "string" && repository.language
        ? repository.language
        : "Не указан",
    stars:
      typeof repository.stargazers_count === "number"
        ? repository.stargazers_count
        : 0,
    forks: typeof repository.forks_count === "number" ? repository.forks_count : 0,
    updatedAt: updatedAtRaw,
    updatedAtMs: updatedAtMs,
    url: typeof repository.html_url === "string" ? repository.html_url : "",
  };
}

function calculateSummary(repositories) {
  var totalStars = 0;
  var totalForks = 0;
  var languages = {};

  repositories.forEach(function (repository) {
    totalStars += repository.stars;
    totalForks += repository.forks;
    languages[repository.language] = (languages[repository.language] || 0) + 1;
  });

  var topLanguages = Object.keys(languages)
    .map(function (language) {
      return {
        language: language,
        count: languages[language],
      };
    })
    .sort(function (left, right) {
      return right.count - left.count;
    })
    .slice(0, 5)
    .map(function (item) {
      return item.language + " (" + item.count + ")";
    })
    .join(", ");

  return {
    totalRepositories: repositories.length,
    totalStars: totalStars,
    totalForks: totalForks,
    topLanguages: topLanguages || "Нет данных",
  };
}

function writeRepositoriesToSheet(sheet, repositories) {
  var maxRows = sheet.getMaxRows();
  sheet.getRange(7, 1, maxRows - 6, 7).clearContent();

  if (repositories.length === 0) {
    return;
  }

  var values = repositories.map(function (repository) {
    return [
      repository.name,
      repository.description,
      repository.language,
      repository.stars,
      repository.forks,
      formatDate(repository.updatedAt),
      repository.url,
    ];
  });

  sheet.getRange(7, 1, values.length, 7).setValues(values);
}

function writeSummaryToSheet(sheet, summary) {
  sheet.getRange("I1").setValue("Summary");
  sheet.getRange("I2").setValue("Total repositories");
  sheet.getRange("I3").setValue("Total stars");
  sheet.getRange("I4").setValue("Total forks");
  sheet.getRange("I5").setValue("Top languages");

  sheet.getRange("J2").setValue(summary.totalRepositories);
  sheet.getRange("J3").setValue(summary.totalStars);
  sheet.getRange("J4").setValue(summary.totalForks);
  sheet.getRange("J5").setValue(summary.topLanguages);

  sheet.getRange("I1:I5").setFontWeight("bold");
}

function writeStatus(sheet, message) {
  sheet.getRange("B3").setValue(message);
}

function formatDate(value) {
  if (!value) {
    return "Дата не указана";
  }

  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
}
