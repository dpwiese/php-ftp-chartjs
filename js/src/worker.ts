require("dotenv").config();
const ftp = require("basic-ftp");
const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
const parse = require("csv-parse/lib/sync");

// Constants
const FTP_REMOTE_PATH = "inbound_wifi/";
const LOCAL_DOWNLOAD_PATH = "./download/";
const S3_DEST_BUCKET_NAME = process.env.S3_DEST_BUCKET_NAME;
const AWS_REGION = "us-east-1";
const CHART_PAST_DAYS = 5;
const DEST_FILE = "out.json";

// Config AWS
AWS.config.update({ region: AWS_REGION });
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  apiVersion: "2006-03-01",
});

// Create FTP client and configure
const ftpClient = new ftp.Client();
ftpClient.ftp.verbose = false;

run();

async function run(): Promise<void> {
  // Get list of all files on FTP server
  const ftpFiles: Array<typeof ftp.FileInfo> = await connectAndGetFileList();
  const ftpFileNames: Array<string> = ftpFiles.map((f: typeof ftp.FileInfo): string => f.name);

  // Generate substrings corresponding to recent files
  const fileNameSubstrings: Array<string> = generateRecentSubstrings();

  // Push all file names whose data should be plotted to fileNames
  const recentFileNames: Array<string> = ftpFileNames.filter((fileName: string): boolean =>
    fileNameSubstrings.some((s: string): boolean => fileName.includes(s))
  );

  // Get local filenames
  const localFileNames: Array<string> = fs.readdirSync(LOCAL_DOWNLOAD_PATH);

  // Get list of files to download that don't already exist locally
  const filesToDownload: Array<string> = recentFileNames.filter(
    (recentFileName: string): boolean => !localFileNames.includes(recentFileName)
  );

  // Download files
  await downloadFilesFromFtp(filesToDownload);

  // Figure out which local files are old and should be deleted
  const updatedLocalFileNames: Array<string> = fs.readdirSync(LOCAL_DOWNLOAD_PATH);
  const localFileNamesToDelete: Array<string> = updatedLocalFileNames.filter(
    (fileName: string): boolean => !fileNameSubstrings.some((s: string): boolean => fileName.includes(s))
  );

  // Delete old local files
  await deleteLocalFiles(localFileNamesToDelete);

  const pearlDate: Array<string> = [];
  const pearlTimeEst: Array<string> = [];
  const pearlBmpTempC: Array<string> = [];
  const pearlLpsTempC: Array<string> = [];
  const pearlShtTempC: Array<string> = [];
  const pearlShtHumidPercent: Array<string> = [];
  const pearlWindSpeedMS: Array<string> = [];
  const pearlDs18TempC: Array<string> = [];

  // Sort remaining recent local files by name before processing
  const localFilesToUpload: Array<string> = fs.readdirSync(LOCAL_DOWNLOAD_PATH).sort(alphabetize);

  // Parse each local CSV file and push the data to local array
  localFilesToUpload.forEach((file: string): void => {
    const records = parse(fs.readFileSync(`${LOCAL_DOWNLOAD_PATH}${file}`, "utf8"), {
      columns: true,
      skip_empty_lines: true,
      skip_lines_with_error: true,
    });

    for (let i = 0; i < records.length; i = i + 1000) {
      pearlDate.push(records[i]["Date"]);
      pearlTimeEst.push(records[i]["Time (EST)"]);
      pearlBmpTempC.push(records[i]["BMP temp(C)"]);
      pearlLpsTempC.push(records[i]["LPS temp (C)"]);
      pearlShtTempC.push(records[i]["SHTtemp (C)"]);
      pearlShtHumidPercent.push(records[i]["SHThumid (%)"]);
      pearlWindSpeedMS.push(records[i]["Wind Speed (m/s)"]);
      pearlDs18TempC.push(records[i]["DS18temp (C)"]);
    }
  });

  interface PearlData {
    date: Array<string>;
    time: Array<string>;
    bmpTempC: Array<string>;
    lpsTempC: Array<string>;
    shtTempC: Array<string>;
    shtHumidPercent: Array<string>;
    windSpeedMS: Array<string>;
    ds18TempC: Array<string>;
  }

  const pearlData: PearlData = {
    date: pearlDate,
    time: pearlTimeEst,
    bmpTempC: pearlBmpTempC,
    lpsTempC: pearlLpsTempC,
    shtTempC: pearlShtTempC,
    shtHumidPercent: pearlShtHumidPercent,
    windSpeedMS: pearlWindSpeedMS,
    ds18TempC: pearlDs18TempC,
  };

  const pearlJson: string = JSON.stringify(pearlData);

  fs.writeFile(DEST_FILE, pearlJson, (err) => {
    if (err) {
      throw err;
    }
    console.log("JSON data is saved.");
    const fileStream = fs.createReadStream(DEST_FILE);
    const uploadParams = { Bucket: S3_DEST_BUCKET_NAME, Key: path.basename(DEST_FILE), Body: fileStream };

    // Upload
    s3.upload(uploadParams, function (err, data) {
      if (err) {
        console.log("Error", err);
      }
      if (data) {
        console.log("Upload Success", data.Location);
        fs.unlinkSync(DEST_FILE);
      }
    });
  });
}

//
async function deleteLocalFiles(fileNames: Array<string>): Promise<void> {
  try {
    await asyncForEach(fileNames, async (fileName) => {
      await fs.unlinkSync(`${LOCAL_DOWNLOAD_PATH}${fileName}`);
    });
  } catch (err) {
    console.log(err);
  }
}

//
function alphabetize(a, b): number {
  if (a.name < b.name) {
    return -1;
  }
  if (a.name > b.name) {
    return 1;
  }
  return 0;
}

//
function generateRecentSubstrings(): Array<string> {
  const fileNames = [];

  // Generate substrings corresponding to recent files
  for (let i = 0; i <= CHART_PAST_DAYS; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    fileNames.push(`SensorLog_${year}-${month}-${day}`);
  }
  return fileNames;
}

//
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

// const downloadFromFtp = async (files) => {
async function downloadFilesFromFtp(fileNames: Array<string>): Promise<void> {
  try {
    await asyncForEach(fileNames, async (fileName: string) => {
      await ftpClient.downloadTo(`${LOCAL_DOWNLOAD_PATH}${fileName}`, `${FTP_REMOTE_PATH}${fileName}`);
    });
    ftpClient.close();
  } catch (err) {
    console.log(err);
    ftpClient.close();
  }
}

//
async function connectAndGetFileList(): Promise<typeof ftp.FileInfo[]> {
  try {
    await ftpClient.access({
      host: process.env.FTP_SERVER,
      user: process.env.FTP_USERNAME,
      password: process.env.FTP_PASSWORD,
      secure: true,
    });
    const files: Array<typeof ftp.FileInfo> = await ftpClient.list(FTP_REMOTE_PATH);
    return files;
  } catch (err) {
    console.log(err);
    ftpClient.close();
  }
}
