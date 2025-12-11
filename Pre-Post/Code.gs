function doGet(e) {
  try {
    const action = e.parameter.action;

    // Route: Get Submissions for Tracker
    if (action === 'get_submissions') {
      const data = getPretestSubmissions();
      return ContentService.createTextOutput(JSON.stringify(data))
          .setMimeType(ContentService.MimeType.JSON);
    }

    // Default Route: Get Data for Form (Metadata)
    const program = e.parameter.program; // Get 'program' param
    const data = getDataForForm(program);
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
        
  } catch (err) {
    // Return error as JSON to avoid CORS issues with HTML error pages
    return ContentService.createTextOutput(JSON.stringify({ 
      error: true, 
      message: err.toString(),
      stack: err.stack
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getDataForForm(filterProgram = null) {
  const SPREADSHEET_ID = '1kW_G1I7koBf-RAOG-rziRb1_N96h28YF7GH1EwTacYI';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  const sheetBranch = ss.getSheetByName('Cabang');
  const sheetTeacher = ss.getSheetByName('Pengajar');
  const sheetStudent = ss.getSheetByName('Peserta-Offline');
  const sheetOnlineTeacher = ss.getSheetByName('Pengajar-Online');
  const sheetOnlineStudent = ss.getSheetByName('Peserta-Online');

  // Helper to safely get data
  const getColData = (sheet, colIndex) => {
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const range = sheet.getRange(2, colIndex, lastRow - 1, 1);
    return range.getValues().flat().filter(String);
  }

  const getPairedData = (sheet, colKey, colVal) => {
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    
    const rawKeys = sheet.getRange(2, colKey, lastRow - 1, 1).getValues().flat();
    const rawVals = sheet.getRange(2, colVal, lastRow - 1, 1).getValues().flat();

    const result = [];
    for(let i=0; i<rawKeys.length; i++) {
        if(rawKeys[i] && rawVals[i]) {
            result.push({city: rawKeys[i].toString().trim(), value: rawVals[i].toString().trim()});
        }
    }
    return result;
  }

  const processBranchData = (pairedList) => {
    const map = {};
    pairedList.forEach(item => {
      if(!map[item.city]) map[item.city] = [];
      if(!map[item.city].includes(item.value)) {
          map[item.city].push(item.value);
      }
    });
    return map;
  };

  const branches = {
    coding: (!filterProgram || filterProgram === 'coding') ? processBranchData(getPairedData(sheetBranch, 4, 5)) : {},
    math: {}, // Math is Online Only
    cloc: {} // Cloc is Online Only
  };

  // --- HELPER PARSERS ---

  // Parse "City - Branch" string
  const parseLocation = (locStr) => {
      if (!locStr) return { city: "", branch: "" };
      const parts = locStr.toString().split(/\s*-\s*/);
      let city = "";
      let branch = "";
      if (parts.length >= 2) {
          city = parts[0].trim();
          branch = parts.slice(1).join(' - ').trim();
      } else {
          city = locStr.toString().trim();
      }
      return { city, branch };
  };

  // --- TEACHERS (Split Layout: B/C, H/I, N/O) ---
  const getOfflineTeachers = (sheet) => {
      if (!sheet) return { coding: [], math: [], cloc: [] };
      const lastRow = sheet.getLastRow();
      if (lastRow < 8) return { coding: [], math: [], cloc: [] };

      const getBlock = (colName, colBranch) => {
          // Get values from Row 8 to LastRow
          const numRows = lastRow - 8 + 1;
          const names = sheet.getRange(8, colName, numRows, 1).getValues().flat();
          const branches = sheet.getRange(8, colBranch, numRows, 1).getValues().flat();
          
          const list = [];
          for (let i = 0; i < names.length; i++) {
              if (names[i] && names[i].toString().trim()) {
                  // Teachers also use City - Branch format in the Branch column
                  const loc = parseLocation(branches[i]);
                  // We send FULL string in 'city' for the frontend filter to match against both Inputs
                  list.push({ 
                      city: branches[i].toString().trim(), 
                      value: names[i].toString().trim() 
                  });
              }
          }
          return list;
      };

      const result = { coding: [], math: [], cloc: [] };
      if (!filterProgram || filterProgram === 'coding') result.coding = getBlock(2, 3);
      // Math is Online Only
      // Cloc is Online Only
      return result;
  };

  // --- ONLINE TEACHERS (Split Layout: B, H, N) ---
  const getOnlineTeachersList = (sheet) => {
      if (!sheet) return { coding: [], math: [], cloc: [] };
      const lastRow = sheet.getLastRow();
      if (lastRow < 8) return { coding: [], math: [], cloc: [] };
      
      const getList = (col) => {
           return sheet.getRange(8, col, lastRow - 8 + 1, 1)
                       .getValues().flat()
                       .filter(x => x && x.toString().trim());
      };

      const result = { coding: [], math: [], cloc: [] };
      if (!filterProgram || filterProgram === 'coding') result.coding = getList(2);
      if (!filterProgram || filterProgram === 'math') result.math = getList(8);
      if (!filterProgram || filterProgram === 'cloc') result.cloc = getList(14);
      return result;
  };

  // --- STUDENTS OFFLINE (Vertical Layout: Name=B, Program=D, Loc=E) ---
  // STARTING ROW: User implies similar to teachers (Row 8)? Or Row 2?
  // Let's use Row 2 to be safe for data, as headers are usually just row 1.
  // Although previously we used Row 8. Let's switch to Row 2 for students to ensure we catch all.
  const getOfflineStudents = (sheet) => {
    // If filtering for online only, we might skip this entirely? 
    // But user might request "cloc" offline student data too.
    // For now, always fetch if needed, BUT current optimization request is for ONLINE.
    // Let's keep it safe: Filter by program if provided.
    
    if (!sheet) return { coding: [], math: [], cloc: [] };
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { coding: [], math: [], cloc: [] };

    const numRows = lastRow - 2 + 1;
    // Get Cols B(2) to E(5) -> 4 columns
    const values = sheet.getRange(2, 2, numRows, 4).getValues();

    const output = { coding: [], math: [], cloc: [] };

    values.forEach(row => {
        const name = row[0].toString().trim(); // Col B (index 0)
        // row[1] = Col C (Email)
        const progRaw = row[2].toString().trim().toLowerCase(); // Col D (index 2)
        const locRaw = row[3].toString().trim(); // Col E (index 3)

        if (!name) return;

        const loc = parseLocation(locRaw);
        const entry = { name: name, city: loc.city, branch: loc.branch };

        if ((!filterProgram || filterProgram === 'coding') && progRaw.includes('coding')) output.coding.push(entry);
        // Math is Online Only
        // Cloc is Online Only
    });

    return output;
  };

  // --- ONLINE STUDENTS (Vertical Layout: Name=B(2), Program=D(4) | Row 11+) ---
  const getOnlineStudentsVertical = (sheet) => {
      if (!sheet) return { coding: [], math: [], cloc: [] };
      const lastRow = sheet.getLastRow();
      if (lastRow < 11) return { coding: [], math: [], cloc: [] };
      
      // Get Data Range from Row 11
      // Col 2 = Name, Col 4 = Program
      const numRows = lastRow - 11 + 1;
      // Fetch B(2) to D(4)
      const data = sheet.getRange(11, 2, numRows, 3).getValues();

      const result = { coding: [], math: [], cloc: [] };
      
      data.forEach(row => {
          const name = row[0].toString().trim(); // Col B
          // row[1] = Col C (Email)
          const prog = row[2].toString().trim().toLowerCase(); // Col D

          if (!name) return;

          if (prog.includes('coding')) result.coding.push(name);
          else if (prog.includes('math')) result.math.push(name);
          else if (prog.includes('cloc')) result.cloc.push(name);
      });
      
      return result;
  };

  const teachers = getOfflineTeachers(sheetTeacher);
  const onlineTeachersDict = getOnlineTeachersList(sheetOnlineTeacher);
  const students = getOfflineStudents(sheetStudent);
  const onlineStudents = getOnlineStudentsVertical(sheetOnlineStudent);

  return {
    branches: branches,
    teachers: teachers,
    onlineTeachers: onlineTeachersDict,
    students: students,
    onlineStudents: onlineStudents,
    debug: {}
  };
}

function doPost(e) {
  const customHeader = ContentService.createTextOutput();
  customHeader.setMimeType(ContentService.MimeType.JSON);

  try {
    const rawData = e.postData.contents;
    const jsonData = JSON.parse(rawData);
    
    // Save to Sheet
    const result = saveData(jsonData);
    
    return customHeader.append(JSON.stringify({ 
      status: 'success', 
      message: 'Data saved',
      score: result.score,
      row: result.row
    }));

  } catch (error) {
    return customHeader.append(JSON.stringify({ 
      status: 'error', 
      message: error.toString() 
    }));
  }
}

function saveData(data) {
  const SPREADSHEET_ID = '1kW_G1I7koBf-RAOG-rziRb1_N96h28YF7GH1EwTacYI';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  let sheet = ss.getSheetByName('pretest-t1');
  if (!sheet) {
    sheet = ss.insertSheet('pretest-t1');
    const headers = [
      'Timestamp', 'Mode', 'Program', 'City', 'Branch', 'Teacher', 'Name', 'Score',
      'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10', 'TestID'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }

  const timestamp = new Date();
  /* 
   * SCORE is now calculated on the Frontend and sent in the payload.
   * This allows for per-form answer keys without bloating this script.
   */
  const score = data.score !== undefined ? data.score : 0;
  
  const row = [
    timestamp,
    data.mode || '',
    data.program || '',
    data.city || '',
    data.branch || '',
    data.teacher || '',
    data.name || '',
    score,
    data.q1 || '',
    data.q2 || '',
    data.q3 || '',
    data.q4 || '',
    data.q5 || '',
    data.q6 || '',
    data.q7 || '',
    data.q8 || '',
    data.q9 || '',
    data.q10 || '',
    data.testId || ''
  ];

  sheet.appendRow(row);
  return { score: score, row: sheet.getLastRow() };
}

/* calculateScore REMOVED - Logic moved to Frontend */

function getPretestSubmissions() {
  const SPREADSHEET_ID = '1kW_G1I7koBf-RAOG-rziRb1_N96h28YF7GH1EwTacYI';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('pretest-t1');
  
  if (!sheet) return [];
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // Only headers or empty
  
  // Get all data: Row 2 to LastRow, Cols 1 to 18 (up to Q10)
  // Columns: 
  // 1: Timestamp
  // 2: Mode
  // 3: Program
  // 4: City
  // 5: Branch
  // 6: Teacher
  // 7: Name
  // 8: Score
  // ...
  
  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues(); // Get up to Score (Col 8)
  
  return data.map(row => ({
    timestamp: row[0],
    mode: row[1],
    program: row[2],
    city: row[3],
    branch: row[4],
    teacher: row[5],
    name: row[6],
    score: row[7]
  }));
}
