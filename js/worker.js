Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv").config();
const ftp = require("basic-ftp");
const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
const parse = require("csv-parse/lib/sync");
const FTP_REMOTE_PATH = "inbound_wifi/";
const LOCAL_DOWNLOAD_PATH = "./download/";
const S3_DEST_BUCKET_NAME = process.env.S3_DEST_BUCKET_NAME;
const AWS_REGION = "us-east-1";
const CHART_PAST_DAYS = 5;
const DEST_FILE = "out.json";
AWS.config.update({ region: AWS_REGION });
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    apiVersion: "2006-03-01",
});
const ftpClient = new ftp.Client();
ftpClient.ftp.verbose = false;
run();
async function run() {
    const ftpFiles = await connectAndGetFileList();
    const ftpFileNames = ftpFiles.map((f) => f.name);
    const fileNameSubstrings = generateRecentSubstrings();
    const recentFileNames = ftpFileNames.filter((fileName) => fileNameSubstrings.some((s) => fileName.includes(s)));
    const localFileNames = fs.readdirSync(LOCAL_DOWNLOAD_PATH);
    const filesToDownload = recentFileNames.filter((recentFileName) => !localFileNames.includes(recentFileName));
    await downloadFilesFromFtp(filesToDownload);
    const updatedLocalFileNames = fs.readdirSync(LOCAL_DOWNLOAD_PATH);
    const localFileNamesToDelete = updatedLocalFileNames.filter((fileName) => !fileNameSubstrings.some((s) => fileName.includes(s)));
    await deleteLocalFiles(localFileNamesToDelete);
    const pearlDate = [];
    const pearlTimeEst = [];
    const pearlBmpTempC = [];
    const pearlLpsTempC = [];
    const pearlShtTempC = [];
    const pearlShtHumidPercent = [];
    const pearlWindSpeedMS = [];
    const pearlDs18TempC = [];
    const localFilesToUpload = fs.readdirSync(LOCAL_DOWNLOAD_PATH).sort();
    localFilesToUpload.forEach((file) => {
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
    const pearlData = {
        date: pearlDate,
        time: pearlTimeEst,
        bmpTempC: pearlBmpTempC,
        lpsTempC: pearlLpsTempC,
        shtTempC: pearlShtTempC,
        shtHumidPercent: pearlShtHumidPercent,
        windSpeedMS: pearlWindSpeedMS,
        ds18TempC: pearlDs18TempC,
    };
    const pearlJson = JSON.stringify(pearlData);
    fs.writeFile(DEST_FILE, pearlJson, (err) => {
        if (err) {
            throw err;
        }
        console.log("JSON data is saved.");
        const fileStream = fs.createReadStream(DEST_FILE);
        const uploadParams = { Bucket: S3_DEST_BUCKET_NAME, Key: path.basename(DEST_FILE), Body: fileStream };
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
async function deleteLocalFiles(fileNames) {
    try {
        await asyncForEach(fileNames, async (fileName) => {
            await fs.unlinkSync(`${LOCAL_DOWNLOAD_PATH}${fileName}`);
        });
    }
    catch (err) {
        console.log(err);
    }
}
function generateRecentSubstrings() {
    const fileNames = [];
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
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}
async function downloadFilesFromFtp(fileNames) {
    try {
        await asyncForEach(fileNames, async (fileName) => {
            await ftpClient.downloadTo(`${LOCAL_DOWNLOAD_PATH}${fileName}`, `${FTP_REMOTE_PATH}${fileName}`);
        });
        ftpClient.close();
    }
    catch (err) {
        console.log(err);
        ftpClient.close();
    }
}
async function connectAndGetFileList() {
    try {
        await ftpClient.access({
            host: process.env.FTP_SERVER,
            user: process.env.FTP_USERNAME,
            password: process.env.FTP_PASSWORD,
            secure: true,
        });
        const files = await ftpClient.list(FTP_REMOTE_PATH);
        return files;
    }
    catch (err) {
        console.log(err);
        ftpClient.close();
    }
}
