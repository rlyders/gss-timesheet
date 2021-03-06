/* 
    Author: Richard@Lyders.com
    Project: https://github.com/rlyders/gss-timesheet
    Description: Google Script for Google Sheets timesheet 
*/

const logCols = {
    START: 'A',
    STOP: 'B',
    HRS: 'C',
    MINS: 'D',
    PROJECT: 'E',
    BILL_PROJECT: 'F',
    LINK: 'G',
    WORK: 'H',
    HOW: 'I',
    NOTES: 'J',
    DISCOUNT: 'K',
    BILL_HRS: 'L',
    PROJ_HRS_WK: 'M',
    PROJ_HRS_PRIOR: 'N',
    PROJ_HRS_TOT: 'O',
    PROJ_EST_HRS: 'P',
    PROJ_HRS_LEFT: 'Q',
    TODAY_HRS: 'S',
    PROJ_HRS_TODAY: 'U'
}

function hashSearch(array, searchText) {
  var hash = {};
  for (var i = 0; i < array.length; i++) {
    if (hash[array[i]]) {
      hash[array[i]] = hash[array[i]].concat(i);
    } else {
      hash[array[i]] = [i];
    }
  }
  return hash[searchText];
}

function getMapValue(aMap, aKey) {
  if (aMap.hasOwnProperty(aKey)) {
    return aMap[aKey];
  } else return null;
}

function addToGroup(tsData, sEndOfWeek, aBillProjectKey, aProjectKey, aWorkKey, aNote, aDayOfWeekNum, aMins) {

  weekData = getMapValue(tsData, sEndOfWeek);
  if (weekData == null) {
    weekData = {};
    tsData[sEndOfWeek] = weekData;
  }

  billProjectData = getMapValue(weekData, aBillProjectKey);
  if (billProjectData == null) {
    billProjectData = {};
    weekData[aBillProjectKey] = billProjectData;
  }

  projectData = getMapValue(billProjectData, aProjectKey);
  if (projectData == null) {
    projectData = {};
    billProjectData[aProjectKey] = projectData;
  }
  
  workData = getMapValue(projectData, aWorkKey);
  if (workData == null) {
    workData = { notes: {}, days: Array(7).fill(0) };
    projectData[aWorkKey] = workData;
  }

  notesMap = workData["notes"];
  noteHrs = getMapValue(notesMap, aNote);
  if (noteHrs == null) {
    notesMap[aNote] = 0; // initialize hrs per note to 0
  }
  notesMap[aNote] = notesMap[aNote] + aMins;

  daysArray = workData["days"];
  daysArray[aDayOfWeekNum - 1] = daysArray[aDayOfWeekNum - 1] + aMins;
}

function getWorkKeyMap() {
  return {
    "reqs": "Requirements Gathering",
    "dev": "Development",
    "loss": "Loss",
    "doc": "Documentation",
    "test": "Testing Support",
    "dep": "Deployment",
    "misc": "Miscellaneous"
  };
}

function getWorkKey(notes) {

  const workKeyMap = getWorkKeyMap();

  var workKey = null;
  for (key in workKeyMap) {
    if (workKeyMap.hasOwnProperty(key)) {
      if (notes.startsWith(key)) {
        workKey = key;
        break;
      }
    }
  }

  if (workKey == null) {
    workKey = "misc";
  }

  return workKey;
}

function getWeekNumStartOnMon(aDate) {

  var dateAtMidnight = new Date(aDate);
  dateAtMidnight.setHours(0, 0, 0, 0);
  const secsPerDay = 60 * 60 * 24;
  const milliSecsPerDay = secsPerDay * 1000;
  const oneJan = new Date(aDate.getFullYear(), 0, 1);
  const oneJanDayOfWeek = oneJan.getDay() || 7;

  let milliSecsSinceOneJan = dateAtMidnight - oneJan;
  let daysSinceOneJan = milliSecsSinceOneJan / milliSecsPerDay;
  return Math.ceil((daysSinceOneJan + oneJanDayOfWeek) / 7);
}

function getWeekEndOnSunday(aDate) {
  const dayOfWeek = aDate.getDay() || 7;
  const daysToAdd = 7 - dayOfWeek;

  var sunday = new Date(aDate);
  sunday.setDate(sunday.getDate() + daysToAdd);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

function addWorkTime(tsData, billProject, project, workKey, notes, startTime, endTime, discount) {
  var startDay = startTime.getDay();
  var endDay = endTime.getDay();
  if (startDay != endDay) {
    var newStartTime = new Date(endTime);
    newStartTime.setHours(0, 0, 0, 0);
    addWorkTime(tsData, billProject, project, workKey, notes, newStartTime, endTime, discount);

    endTime = new Date(startTime);
    endTime.setHours(23, 59, 59, 999)
  }
  var millis = Math.abs(endTime - startTime);
  if (discount > 0) {
    millis = millis * (1 - discount);
  }
  var mins = (millis / 1000) / 60;
  addToGroup(tsData, getWeekEndOnSunday(startTime), billProject, project, workKey, notes, startTime.getDay() || 7, mins);
}

function createTimesheet() {

  var lightBlue = "#e8f0f3";
  var darkBlue = "#5b95f9";
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var settingsSheet = ss.getSheetByName("settings");
  var settingsValues = settingsSheet.getRange(1, 1, 2, 2).getValues();
  var timesheetEndOfWeek = settingsValues[1][1];

  var sheet = ss.getSheetByName("Time Log");

  var rangeData = sheet.getDataRange();
  var lastColumn = rangeData.getLastColumn();
  var lastRow = getLastStartTimeRow();
  var searchRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);

  var tsData = {};

  // Get array of values in the search Range
  var rangeValues = searchRange.getValues();
  var startTimeColNum = 1;
  var stopTimeColNum = 2;
  var projectColNum = 5;
  var billProjectColNum = 6;
  var workTypeColNum = 8;
  var notesColNum = 10;
  var discountColNum = 11;
  var trimAfterSpaceInProject = false;
  
  for (r = 0; r < lastRow - 1; r++) {
    var startTime = rangeValues[r][startTimeColNum-1];
    var endTime = rangeValues[r][stopTimeColNum-1];
    if (startTime.length == 0 || endTime.length == 0) {
      continue;
    }

    var project = rangeValues[r][projectColNum-1];
    var billProject = rangeValues[r][billProjectColNum-1];
    
    var workKey = rangeValues[r][workTypeColNum-1];
    var notes = rangeValues[r][notesColNum-1];
    var discount = rangeValues[r][discountColNum-1];

    if (trimAfterSpaceInProject) {
     var spaceInProject = project.indexOf(' ');
     if (spaceInProject > 0) {
       project = project.substring(0, spaceInProject);
     }
    }
    
    addWorkTime(tsData, billProject, project, workKey, notes, startTime, endTime, discount);
  };

  var timesheetObj =  new Timesheet(timesheetEndOfWeek, tsData);

  var timeSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("timesheet");
  
  var rows = createTimeSheetArray(timesheetObj);

  var totCols = 11; // Week, Project, Work, Notes, Total Hours, Mon, Tue, Wed, Thu, Fri, Sat, Sun
  timeSheet.getRange(1, 1, rows.length + 100, totCols + 50).clear();

  var range = timeSheet.getRange(1, 1, rows.length, totCols);
  range.setValues(rows);

  weekEndCell = timeSheet.getRange(1, totCols - 6, 1, 7);
  weekEndCell.merge();
  weekEndCell.setNumberFormat("MMM d, yyyy");
  weekEndCell.setFontWeight("bold");
  weekEndCell.setBackground(darkBlue);

  for (var c = 1; c <= rows[0].length; c++) {
    headerRow = timeSheet.getRange(2, c);
    headerRow.setFontWeight("bold");
    headerRow.setBackground(darkBlue);

    totalsRow = timeSheet.getRange(rows.length, c);
    totalsRow.setFontWeight("bold");
    totalsRow.setBackground(darkBlue);
  }

  for (var r = 3; r <= rows.length - 1; r++) {
    for (var c = 1; c <= rows[0].length; c++) {
      timeSheet.getRange(r, c).setBorder(true, true, true, true, false, false, "grey", SpreadsheetApp.BorderStyle.SOLID);
      if (r % 2 == 0) {
        timeSheet.getRange(r, c).setBackgroundColor(lightBlue);
      }
    }

    projectCol = timeSheet.getRange(r, 1);
    projectCol.setFontWeight("bold");
    projectCol.setBackground("lightgrey");

    TotalCol = timeSheet.getRange(r, 4);
    TotalCol.setFontWeight("bold");
    TotalCol.setBackground("lightgrey");
  }

  totalLabel = timeSheet.getRange(rows.length, 3);
  totalLabel.setFontWeight("bold");
  totalLabel.setBackground(darkBlue);
  totalLabel.setHorizontalAlignment("right")

  var file = saveJsonTimesheet(timesheetObj);
  var fileUrl = file.getUrl();
  // var url = DocsList.getFileById(file.getId()).getUrl();

  var urlLabelRange = timeSheet.getRange("A1");
  urlLabelRange.setValue("JSON: ");

  var urlRange = timeSheet.getRange("B1");
  urlRange.setValue(fileUrl);
    
  ss.setActiveSheet(ss.getSheetByName("timesheet"));
};

// from: https://stackoverflow.com/a/33813783/5572674
/**
 * Convert any spreadsheet value to a date.
 * Assumes that numbers are using Epoch (days since 1 Jan 1900, e.g. Excel, Sheets).
 * 
 * @param {object}  value  (optional) Cell value; a date, a number or a date-string 
 *                         will be converted to a JavaScript date. If missing or
 *                         an unknown type, will be treated as "today".
 *
 * @return {date}          JavaScript Date object representation of input value.
 */
function convert2jsDate(value) {
  var jsDate = new Date();  // default to now
  if (value) {
    // If we were given a date object, use it as-is
    if (typeof value === 'date') {
      jsDate = value;
    }
    else {
      if (typeof value === 'number') {
        // Assume this is spreadsheet "serial number" date
        var daysSince01Jan1900 = value;
        var daysSince01Jan1970 = daysSince01Jan1900 - 25569 // 25569 = days TO Unix Time Reference
        var msSince01Jan1970 = daysSince01Jan1970 * 24 * 60 * 60 * 1000; // Convert to numeric unix time
        var timezoneOffsetInMs = jsDate.getTimezoneOffset() * 60 * 1000;
        jsDate = new Date(msSince01Jan1970 + timezoneOffsetInMs);
      }
      else if (typeof value === 'string') {
        // Hope the string is formatted as a date string
        jsDate = new Date(value);
      }
    }
  }
  return jsDate;
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('My Timesheet')
    .addItem('Create Timesheet', 'createTimesheet')
    .addToUi();
};

function getWorkKeyFromNote(note, workKey) {
  var workKey = getWorkKey(note);

  if (workKey != null && workKey.length > 0) {
    if (note.startsWith(workKey)) {
      note = note.substring(workKey.length, note.length).trim();
    }
  }
  return { note, workKey };
}

function createTimeSheetArray(timeSheetObj) {
  var rows = [];
  var topRow = ["", "", "", "", "", "", "", "", "", "", timeSheetObj.endOfWeek];
  var rowIdx = 0;
  rows.push(topRow);
  var headerRow = ["Project", "Work", "Notes", "TotHrs", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  rows.push(headerRow);
  var startDataRowNum = rows.length + 1;

  for (const tsRow of timeSheetObj.rows) {
        var rowCells = [];
        rowCells.push(tsRow.project);
        rowCells.push(tsRow.workType);
        rowCells.push(tsRow.notes);
        rowCells.push(tsRow.totalHours);
        for (const dayHrs of tsRow.dayHours) {
          rowCells.push(dayHrs);
       }
       rows.push(rowCells);
  }
  var sumColumnFormula = '=sum(INDIRECT("R' + startDataRowNum + 'C"&column()&":"&"R"&(row()-1)&"C"&column(),false))';
  var totalRowCells = ["", "", "TOTAL:", sumColumnFormula, sumColumnFormula, sumColumnFormula, sumColumnFormula, sumColumnFormula, sumColumnFormula, sumColumnFormula, sumColumnFormula];
  rows.push(totalRowCells);
  return rows;
}

class TimesheetRow {
  constructor( project, workType, notes, totalHours, dayHours) {
    this.project = project;
    this.workType = workType;
    this.notes = notes;
    this.totalHours = totalHours;
    this.dayHours = dayHours;
  }
  
}

class Timesheet {
  constructor(timesheetEndOfWeek, tsData) {
    this.endOfWeek = timesheetEndOfWeek;
    this.rows = [];
  
  const workKeyMap = getWorkKeyMap();
  
  var roundedOffMins = 0;
  for (const endOfWeek in tsData) {
    if (timesheetEndOfWeek != endOfWeek) {
      continue;
    }
          
    for (const billProject in tsData[endOfWeek]) {
      if (billProject.toLowerCase() == "personal") {
        continue;
      }

    billProjectData = tsData[endOfWeek][billProject];
    for (const project in billProjectData) {
      if (project.toLowerCase() == "personal") {
        continue;
      }

      projectData = billProjectData[project];
      for (const workType in projectData) {
        
        var mappedWorkType = getMapValue( workKeyMap, workType );
        mappedWorkType = mappedWorkType == null ? workType: mappedWorkType;

        var workTypeData = projectData[mappedWorkType];
  
        var notePrefix = "";
        if (billProject != project)  {
          var prefixDelimiter = (project.length > 0 && mappedWorkType.length > 0) ? ":" : "";
          notePrefix = `[${project}${prefixDelimiter}${mappedWorkType}] `;
          mappedWorkType = "";
        } else if (billProject == "OVERHEAD" && mappedWorkType.length > 0) {
          notePrefix = `[${mappedWorkType}] `;
          mappedWorkType = "";
        }
  
        var notes = "";
        for (const note in workTypeData.notes) {
          if (notes.length == 0) {
          notes = notePrefix;
         } else {
           notes = notes + "; ";
         }
          var noteMins = Math.round(workTypeData.notes[note]);
          var timeStr = noteMins + "m";
          if (noteMins > 60) {
            var noteHrs = Math.trunc(noteMins / 60);
            noteMins = noteMins - noteHrs * 60;
            timeStr = noteHrs + "h " + noteMins + "m";
          }
          notes = notes + note + "{" + timeStr + "}";
          if (notes.length > 400) {
          notes = notes.substring(0,395) + "\u2026";
         }
        }

        var totalRowHours = 0;
        var dayHours = [];
        for (const day in workTypeData.days) {
          var mins = workTypeData.days[day];
          mins = applyMinBlockOfTime(mins);
          roundedOffMins = roundedOffMins + (workTypeData.days[day] - mins);
          var hrs = +(mins / 60).toFixed(2);
          totalRowHours = totalRowHours + hrs;
          dayHours.push(hrs);
        }
        
        var timesheetRow = new TimesheetRow(billProject, mappedWorkType, notes, totalRowHours, dayHours);
        this.rows.push(timesheetRow);
      }
    }
    }
   }
   
   this.rows.sort((a, b) => (a.project+':'+a.workType > b.project+':'+b.workType) ? 1 : -1)
   var minRoundedOffMins = applyMinBlockOfTime(roundedOffMins);
   var minRoundedOffHrs = +(minRoundedOffMins / 60).toFixed(2);
   if (minRoundedOffHrs != 0) {
       this.rows.push(new TimesheetRow("OVERHEAD", null, "balance of rounded-off time", minRoundedOffHrs, [minRoundedOffHrs,0,0,0,0,0,0]));
    }
  }
}

function applyMinBlockOfTime(mins) {
  var minBlockOfMins = 15;
  mins = Math.round(mins / minBlockOfMins) * 15;
  return mins;
}

function test() {
  var tsData = {};

  var project = "ITR6017 Consignments>EBS";
  var billProject = "ITR 6017";
  var note = "dep int";
  var noteAndWorkKey = getWorkKeyFromNote(note);
  var startTime = new Date("2020-04-27T10:05:40.622Z");
  var endTime = new Date("2020-04-27T11:59:57.318Z");
  var discount = 0;
  addWorkTime(tsData, billProject, project, noteAndWorkKey.workKey, noteAndWorkKey.note, startTime, endTime, discount);

  //   project = "ITR6017 Consignments>EBS";
  //   note = "test int";
  //   var noteAndWorkKey = getWorkKeyFromNote(note);
  //   startTime = new Date("2020-04-27T11:56:40.622Z");
  //   endTime = new Date("2020-04-27T12:58:57.318Z");
  //   discount = 0;
  //   addWorkTime(tsData, project, noteAndWorkKey.workKey, noteAndWorkKey.note, startTime, endTime, discount);

  //   project = "ITR6017 Consignments>EBS";
  //   note = "test int";
  //   var noteAndWorkKey = getWorkKeyFromNote(note);
  //   startTime = new Date("2020-04-29T11:56:40.622Z");
  //   endTime = new Date("2020-04-29T14:58:57.318Z");
  //   discount = 0;
  //   addWorkTime(tsData, project, noteAndWorkKey.workKey, noteAndWorkKey.note, startTime, endTime, discount);

  //   /*
  // 5/1/2020	ITR6017 Consignments>EBS	dev process lock	2020-05-01T22:02:00.000Z	2020-05-02T01:01:00.000Z	2.9833	50.00%
  // */
  //   project = "ITR6017 Consignments>EBS";
  //   note = "dev process lock";
  //   var noteAndWorkKey = getWorkKeyFromNote(note);
  //   startTime = new Date("2020-05-01T22:02:00.000Z");
  //   endTime = new Date("2020-05-02T01:01:00.000Z");
  //   discount = 0;
  //   addWorkTime(tsData, project, noteAndWorkKey.workKey, noteAndWorkKey.note, startTime, endTime, discount);

  //   /*
  // 5/2/2020	ITR6017 Consignments>EBS	dev logging	2020-05-02T12:43:00.000Z	2020-05-02T19:36:54.670Z	6.8983	100.00%
  // */
  //   project = "ITR6017 Consignments>EBS";
  //   note = "dev logging";
  //   var noteAndWorkKey = getWorkKeyFromNote(note);
  //   startTime = new Date("2020-05-02T12:43:00.000Z");
  //   endTime = new Date("2020-05-02T19:36:54.670Z");
  //   discount = 0;
  //   addWorkTime(tsData, project, noteAndWorkKey.workKey, noteAndWorkKey.note, startTime, endTime, discount);

  /*
5/3/2020	ITR6017 Consignments>EBS	dev emails missing received sent ts	2020-05-03T12:54:05.396Z	2020-05-03T14:40:22.583Z	1.7714	100.00%
*/
  project = "ITR6017 Consignments>EBS";
  note = "dev emails missing received sent ts";
  var noteAndWorkKey = getWorkKeyFromNote(note);
  startTime = new Date("2020-05-03T12:54:05.396Z");
  endTime = new Date("2020-05-03T14:40:22.583Z");
  discount = 0;
  addWorkTime(tsData, project, noteAndWorkKey.workKey, noteAndWorkKey.note, startTime, endTime, discount);

  createTimeSheetArray(tsData, new Date("May 3, 2020"));
}

function testWeekNum() {
  // var date = new Date('1/1/2020');
  // var weekNum = getWeekNumStartOnMon(date);
  // console.log("weekNum=" + weekNum);

  // var date = new Date('1/5/2020');
  // var weekNum = getWeekNumStartOnMon(date);
  // console.log("weekNum=" + weekNum);

  // var date = new Date('1/6/2020');
  // var weekNum = getWeekNumStartOnMon(date);
  // console.log("weekNum=" + weekNum);

  // var date = new Date('1/12/2020');
  // var weekNum = getWeekNumStartOnMon(date);
  // console.log("weekNum=" + weekNum);

  // var date = new Date('1/13/2020');
  // var weekNum = getWeekNumStartOnMon(date);
  // console.log("weekNum=" + weekNum);

  // var date = new Date('4/29/2020');
  // var weekNum = getWeekNumStartOnMon(date);
  // console.log("weekNum=" + weekNum);

  // var date = new Date('5/2/2020');
  // var weekNum = getWeekNumStartOnMon(date);
  // console.log("weekNum=" + weekNum);

  var date = new Date('5/2/2020 14:04:00');
  var weekNum = getWeekNumStartOnMon(date);
  console.log("weekNum=" + weekNum);

  var date = new Date('5/3/2020 00:00:00');
  var weekNum = getWeekNumStartOnMon(date);
  console.log("weekNum=" + weekNum);

  var date = new Date('5/3/2020 14:04:00');
  var weekNum = getWeekNumStartOnMon(date);
  console.log("weekNum=" + weekNum);
}

function getTimeLogSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Time Log");
}

function getLastStartTimeRow() {
          var sheet = getTimeLogSheet();
          var lastStartTimeRow = sheet.getCurrentCell().getRow();
          // move down as long as the current previous is not empty
          while (!sheet.getRange("A"+(lastStartTimeRow+1)).isBlank()) {
              lastStartTimeRow++;
         }
          // move up as long as the previous cell is empty
          while (sheet.getRange("A"+(lastStartTimeRow)).isBlank()) {
              lastStartTimeRow--;
         }
          sheet.setActiveRange(sheet.getRange("A"+lastStartTimeRow));
          return lastStartTimeRow;
}

function nextChar(c) {
  return String.fromCharCode(c.charCodeAt(0)+1);
}

function startTime() {
    var updated = stopTime();
    var sheet = getTimeLogSheet();
    var r = getLastStartTimeRow() + 1;
    var newStartTimeRange = sheet.getRange(`${logCols.START}${r}`);
    if (updated) {
    newStartTimeRange.setValue(`=${logCols.STOP}${r-1}`);
    } else {
    recordCurrentTime(newStartTimeRange);
    }
    
    // orig:                                       =if(ISBLANK(A               2   ),0,(if(ISBLANK(B              2   ),now(),B              2   )-A               2   )*24)
    sheet.getRange(`${logCols.HRS}${r}`).setValue(`=if(ISBLANK(${logCols.START}${r}),0,(if(ISBLANK(${logCols.STOP}${r}),now(),${logCols.STOP}${r})-${logCols.START}${r})*24)`);
    
    // orig:                                        =C             2   *60
    sheet.getRange(`${logCols.MINS}${r}`).setValue(`=${logCols.HRS}${r}*60`);

    // orig:                                                =if(ISBLANK(E                 2   ),"OVERHEAD", if(vlookup(E                 2   ,Projects!A$2:A,1,true)=E                 2   ,E                 2   ,"OVERHEAD"))
    sheet.getRange(`${logCols.BILL_PROJECT}${r}`).setValue(`=if(ISBLANK(${logCols.PROJECT}${r}),"OVERHEAD", if(vlookup(${logCols.PROJECT}${r},Projects!A$2:A,1,true)=${logCols.PROJECT}${r},${logCols.PROJECT}${r},"OVERHEAD"))`);
    
    sheet.getRange(`${logCols.LINK}${r}`).setValue(`=if(left(${logCols.BILL_PROJECT}${r},3)="INC",hyperlink("https://airliquide.service-now.com/nav_to.do?uri=%2Fincident.do?sysparm_query=number="&${logCols.BILL_PROJECT}${r},${logCols.BILL_PROJECT}${r}),if(left(${logCols.BILL_PROJECT}${r},3)="TKT",hyperlink("https://airliquide.service-now.com/nav_to.do?uri=ticket.do?sysparm_query=number="&${logCols.BILL_PROJECT}${r},${logCols.BILL_PROJECT}${r}),if(left(${logCols.BILL_PROJECT}${r},5)="ADHOC",hyperlink("https://airliquide.service-now.com/nav_to.do?uri=%2Fu_ad_hoc_request.do?sysparm_query=number="&${logCols.BILL_PROJECT}${r},${logCols.BILL_PROJECT}${r}),if(${logCols.BILL_PROJECT}${r}="ETS",hyperlink("http://dev-tools/gitlab/application/dev-timesheets/issues","ITR IT-INT-1"),if(${logCols.BILL_PROJECT}${r}="3-A-INC",hyperlink("http://itr.am.corp.airliquide.com/ticket/5840","5840"),if(REGEXMATCH(${logCols.BILL_PROJECT}${r},"ITR#[0-9]*"),hyperlink("http://itr.am.corp.airliquide.com/query?itr_id="&REGEXEXTRACT(${logCols.BILL_PROJECT}${r},"[0-9]+"),"ITR#"&REGEXEXTRACT(${logCols.BILL_PROJECT}${r},"[0-9]+")),if(REGEXMATCH(${logCols.BILL_PROJECT}${r},"ITR[0-9]*"),hyperlink("http://itr.am.corp.airliquide.com/ticket/"&REGEXEXTRACT(${logCols.BILL_PROJECT}${r},"[0-9]+"),"ITR"&REGEXEXTRACT(${logCols.BILL_PROJECT}${r},"[0-9]+")),"")))))))`);
  
    // orig:                                            =if(lower(E2                    )="personal",0,if(isblank(K2                     ),C2                ,C2                *(1-K2                     )))
    sheet.getRange(`${logCols.BILL_HRS}${r}`).setValue(`=if(lower(${logCols.PROJECT}${r})="personal",0,if(isblank(${logCols.DISCOUNT}${r}),${logCols.HRS}${r},${logCols.HRS}${r}*(1-${logCols.DISCOUNT}${r})))`);

    // orig:                                               =sumif(E                 $2:E                 , E2                    , L                  $2:L)
    sheet.getRange(`${logCols.PROJ_HRS_WK}${r}`).setValue(`=sumif(${logCols.PROJECT}$2:${logCols.PROJECT}, ${logCols.PROJECT}${r}, ${logCols.BILL_HRS}$2:${logCols.BILL_HRS})`);

    // orig:                                                  =if(F2                         ="OVERHEAD",0,vlookup(F2                         , Projects!A:I,9,false))
    sheet.getRange(`${logCols.PROJ_HRS_PRIOR}${r}`).setValue(`=if(${logCols.BILL_PROJECT}${r}="OVERHEAD",0,vlookup(${logCols.BILL_PROJECT}${r}, Projects!A:I,9,false))`);

    // orig:                                                =if(F2                         ="OVERHEAD",0,M2                        +N2)
    sheet.getRange(`${logCols.PROJ_HRS_TOT}${r}`).setValue(`=if(${logCols.BILL_PROJECT}${r}="OVERHEAD",0,${logCols.PROJ_HRS_WK}${r}+${logCols.PROJ_HRS_PRIOR}${r})`);

    // orig:                                                =if(F2                         ="OVERHEAD",0,vlookup($E2                        , Projects!A:I,8,false))
    sheet.getRange(`${logCols.PROJ_EST_HRS}${r}`).setValue(`=if(${logCols.BILL_PROJECT}${r}="OVERHEAD",0,vlookup(${logCols.BILL_PROJECT}${r}, Projects!A:I,8,false))`);

    // orig:                                                 =if(or(F2                         ="OVERHEAD",Q2                         =0),"",Q2                         -P2   )
    sheet.getRange(`${logCols.PROJ_HRS_LEFT}${r}`).setValue(`=if(or(${logCols.BILL_PROJECT}${r}="OVERHEAD",${logCols.PROJ_EST_HRS}${r}=0),"",${logCols.PROJ_EST_HRS}${r}-${logCols.PROJ_HRS_TOT}${r})`);

    // orig:                                             =if(TO_DATE(INT(A2                  ))=today(),C2                ,0)
    sheet.getRange(`${logCols.TODAY_HRS}${r}`).setValue(`=if(TO_DATE(INT(${logCols.START}${r}))=today(),${logCols.HRS}${r},0)`);
  
    // orig:                                                  =sumif(E                 $2:E                 , E                 2   , S                   $2:S)
    sheet.getRange(`${logCols.PROJ_HRS_TODAY}${r}`).setValue(`=sumif(${logCols.PROJECT}$2:${logCols.PROJECT}, ${logCols.PROJECT}${r}, ${logCols.TODAY_HRS}$2:${logCols.TODAY_HRS})`);
  
}

function stopTime() {
          var sheet = getTimeLogSheet();
          var currentTimerRow = getLastStartTimeRow();
          var newStopTimeRange = sheet.getRange("B"+currentTimerRow);
          var updated = recordCurrentTime(newStopTimeRange);
          return updated;
}

function recordCurrentTime(cell) {
          var updated = false;          
          if (cell.isBlank()) {
          cell.setValue(new Date()).setNumberFormat('ddd mmm d h:mma/p');
          updated=true;
         }
          return updated;
}
          // test();

function saveData(folder, fileName, contents) {

  var children = folder.getFilesByName(fileName);
  var file = null;
  if (children.hasNext()) {
    file = children.next();
    file.setContent(contents);
    return file;
  } else {
    file = folder.createFile(fileName, contents);
    return file;
  }
}

function saveJsonTimesheet(timesheetObj) {
  var fileName = "Timesheet-"+timesheetObj.endOfWeek.getFullYear()+"-"+(timesheetObj.endOfWeek.getMonth()+1)+"-"+timesheetObj.endOfWeek.getDate()+".json"
  var folder = DriveApp.getFolderById("1PLmKRCtQja-mI2R7-wjiCaB-XiMYl-te");
  if (folder != null) {
    return saveData(folder, fileName, JSON.stringify(timesheetObj));
  }

}
