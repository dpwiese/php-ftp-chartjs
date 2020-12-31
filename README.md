# PHP FTP ChartJS

This repo contains source code for a small project: **create quasi-realtime charts on a Wordpress site from data periodically uploaded to an FTP server**.

## Introduction

The most convenient approach would have been connecting to the FTP server from the browser to access, parse, and plot the data.
This would've created issues doing this securely without exposing the FTP credentials, and would have created performance limitations if there was a lot of data that needed to be parsed.
Regardless, it seems browsers are dropping or have dropped support for FTP anyway as described in the Chrome Platform Status [Feature: Deprecate FTP support (deprecated)](https://www.chromestatus.com/feature/6246151319715840) page, on the Bugzilla ticket [Remove FTP support](https://bugzilla.mozilla.org/show_bug.cgi?id=1574475), as well as in the Mozilla Blog [What to expect for the upcoming deprecation of FTP in Firefox](https://blog.mozilla.org/addons/2020/04/13/what-to-expect-for-the-upcoming-deprecation-of-ftp-in-firefox/).
Now, browsers like Safari 14 and Chrome 87 both launch the built-in file manager when attempting to access an FTP server.

It seems [XMLHttpRequest](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest) used to be a potential option, as described in the [2014 documentation](https://web.archive.org/web/20141205110759/https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest):

> Despite its name, `XMLHttpRequest` can be used to retrieve any type of data, not just XML, and it supports protocols other than HTTP (including file and ftp).

However, that is no longer the case.
Basically, all this meant that if the FTP needed to be accessed, it needed to be done server-side.

This was a more sensible implementation for the reasons described above - FTP credentials could be hidden from the user, and computation could be more performant server-side.
The downside with this approach, described in more detail below, can be performance loss and complexity in an otherwise simple (e.g. Wordpress) site if there are many files and lots of data that need to be pulled and parsed before displaying it.

A third and most complex option, although likely the correct approach given the specifics of the problem, is to make a worker connect to the FTP server periodically, retrieve new data files, parse and downsample the data, and save it as JSON where it can be easily accessed via HTTPS from the browser.
This is quite a straightforward approach but could require creating an API if the constraints of the problem change, for example needing to specify the downsample rate, the time period of data to return, or the particular metric from within the data to return.

## Using

```sh
# Install for local development
% npm install

# Install for production
% npm install --production

# Compile
% tsc

# Run eslint
% npm run lint
```

The `worker.js` script is on EC2 at `/home/ec2-user/pearl` and run from cron in `/etc/crontab`.
In the `pearl` directory are:

```
download
node_modules
package.json
package-lock.json
worker.js
```

# EC2 FTP Server

As a first step, I wanted to create my own FTP server which I could use to develop and test against.
My first thought was to see if AWS offered a simple, easy-to-use FTP server and found [AWS Transfer Family](https://aws.amazon.com/aws-transfer-family/).
This seemed like a convenient option:

> Simple and seamless file transfer to Amazon S3 using SFTP, FTPS, and FTP

At first it seemed like it could be a cheap and simple way to throw some sample data into an S3 bucket and configure an FTP endpoint to give access to that data.
But at $0.30 per hour just to have the FTP endpoint enabled was about $216/month which was way too much, so I never figured out whether it was simple or not.
There didn't seem to be any other good cheap or free FTP servers for such a project - just somewhere to throw a few megabytes of data and test reading the data from an FTP client.
EC2 seemed like a convenient and flexible way to go.

Checking the EC2 [On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/), a `t3a.nano` is $0.0047 per Hour or less than $3.50/month.
After launching the instance the following links were helpful:
[Connect to your Linux instance using an SSH client](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AccessingInstancesLinux.html) and [Get information about your instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connection-prereqs.html#connection-prereqs-get-info-about-instance) which said:

> For Amazon Linux 2 or the Amazon Linux AMI, the user name is `ec2-user`.

To connect via SSH with the downloaded key, the following command is used:

```sh
% ssh -i "/Users/dpwiese/Library/Mobile Documents/com~apple~CloudDocs/programming/keys-and-security/dpwiese-aws-ec2-t2a-nano.pem" ec2-user@3.216.36.9
```

With a new EC2 instance created, I now needed to start an FTP server.

## Setting up the FTP Server on EC2

The post [How to Configure FTP on AWS EC2](https://medium.com/tensult/configure-ftp-on-aws-ec2-85b5b56b9c94) was one of the first ones to show up in search, and had the few simple steps to follow to install and configure [vsftpd](https://security.appspot.com/vsftpd.html).

```sh
# Edit vsftpd configuration
% sudo nano /etc/vsftpd/vsftpd.conf

# Restart vsftpd
% sudo systemctl restart vsftpd
```

Having following the steps in the post above, the FTP server was ready to develop and test against.
With some test data in `/var/ftp/` the user `awsftpuser` with its corresponding password were used to connect.

# Accessing FTP from PHP

With the FTP server up, it was now time to attempt to connect and access the data via PHP.

## Environment Setup

Running [PHP's Built-in web server](https://www.php.net/manual/en/features.commandline.webserver.php) to serve locally

```sh
% php -S 127.0.0.1:8000
```

Dependency management is handled with [composer](https://getcomposer.org/).
The first dependency that was installed was [PHP dotenv](https://github.com/vlucas/phpdotenv) to store the FTP credentials in environment variables.
Available on [packagist.org](https://packagist.org/packages/vlucas/phpdotenv).

```sh
# /usr/local/bin/composer
% which composer

# Install
% composer install
```

With minimal effort, `index.php` was served up locally, containing the code to connect to the FTP server, read and parse the data, and then pass it to JavaScript for plotting with [Chart.js](https://www.chartjs.org).

## Retrieving and Plotting the Data

Note in the code below the backtick for using multiline string, since when this example was first implemented `$bar` were the contents of a file, including newlines, which created an error `Uncaught SyntaxError: Invalid or unexpected token`.

```html
<script type="text/javascript">
  var foo = `<?php echo $bar; ?>`;
  console.log(foo);
</script>
```

The following option didn't end up being used.

```php
// Set passive address false
ftp_set_option($ftp_conn, FTP_USEPASVADDRESS, false);
```

The following snippet was used to get the modified timestamp of each file on the FTP server so only the most recent ones could be downloaded.
Beyond this operation taking a long time, it seemed like a bad idea to use the timestamp, in case a _file_ was modified after its original write, thus returning data out of order.

```php
foreach ($files as $file) {
  // get the last modified time for the file
  // This is an expensive operation... Takes 10 seconds or so to get timestamp for all of ~800 files
  // https://stackoverflow.com/questions/16055235/how-can-i-download-the-most-recent-file-on-ftp-with-php/16056100
  $time = ftp_mdtm($ftp_conn, $file);
  var_dump($time);
}
```

Using `microtime` below was a good way to benchmark clock time taken during certain operations, for example waiting for files to download.

```php
// DEBUG: Start time
$time_start = microtime(true);

// DEBUG: End time
$time_end = microtime(true);
$execution_time = ($time_end - $time_start);
echo '<b>Total Execution Time:</b> '.$execution_time.' Seconds';
```

This approach did work, using the [PHP FTP Extension](https://www.php.net/manual/en/book.ftp.php) and it's `ftp_fget()` function to read files from the FTP server, and functions like `str_getcsv()` to read and parse the CSV files, and downsample the contained data.
Plotting the data was straightforward in JavaScript.
However, using `microtime()` to measure the clock time for each call to `ftp_fget()` to download the file revealed about 500 ms to download the 600 kb file.
In this case there was a file generated every hour, and the past five days worth of data needed to be plotted, resulting in 120 files that needed to be downloaded and read.
At 500 ms each, this meant it would take about one minute to download them all.

Even with an order of magnitude increase in the download speed, it would still be too slow to use for its intended purpose.
The downloads could also potentially be parallelized.
The complexity required to do this and the limitations are not completely known to me, but regardless of how optimized this could be made, it doesn't remove the need to fetch 72 mb of data on each page load.

At this point there are two obvious alternatives to me.
1. Save the downloaded and parsed data to disk with something like `file_put_contents()` and use this local data for plotting.
This way, only which have not previously been downloaded need to, and the small local files can easily be read and plotted from.
This approach would require care to manage the local files and keep the local contents updated with the remote contents on the FTP, and if the processing and local saving was only triggered on page load, then the problem of having to fetch many files could still exist if there were no visitors to the page for some time.
Of course, that last problem could be easily solved by automating a visitor to the site to trigger this processing, but overall the solution is sounding terribly complex.
What should be a simple site to display some charts to a user now needs to perform FTP requests, and process and manage a bunch of data and files.
2. Create a worker that runs on a schedule to pull the latest files from the FTP, parse and downsample them, save the result to disk, and provide an API from which the PHP site can fetch the latest data.
Given this application need only quasi-realtime data, this seems like the most reasonable approach - run this processor every hour, and even if some operations take some time, it won't affect the user experience on the site.

# Worker

This was best implemented on EC2.
The instance used for the FTP above could use cron to run this script, and store the files downloaded from the FTP.

## Dependencies

There were a few FTP clients available for node, including [node-ftp](https://github.com/mscdex/node-ftp), [jsftp](https://github.com/sergi/jsftp), and [basic-ftp](https://github.com/patrickjuchli/basic-ftp) - the least popular option but with promise-based that was selected for this project.

[dotenv](https://github.com/motdotla/dotenv) was used to retrieve the FTP conviguration from `.env` as well as the AWS configuration.
On my local environment, the credentials needed for the AWS SDK was automatically loaded from `~/.aws/credentials`, but on EC2 it wasn't immediately obvious what was wrong.
A quick solution was to just use dotenv.

To parse the downloaded CSV, [csv.js](https://csv.js.org) was used.
Given some of the data turned out to be malformed, the [`skip_lines_with_error`](https://csv.js.org/parse/options/skip_lines_with_error/) option was useful.

## Cron

Setting up cron was relatively straightforward, and some common commands are below.
Main points to be mindful of when configuring cron are which user to use, the corresponding file permissions and `PATH` that are set, and to `cd` into the directory from where the script should be run.
For example, when running as `ec2-user`, it didn't have permission to run `node`, nor write to `/tmp/cron.log`.
Lastly, there were some AWS credentials issues, probably because of `PATH`, hence using `dotenv` to load AWS credentials.

```sh
# Edit this file instead, system-wide crontab
% sudo nano /etc/crontab

# Check crontab status
% /bin/systemctl status crond.service

# Restart cron
% /bin/systemctl restart crond.service

# View cron in system logs
% journalctl |grep -i cron|tail -20

# View cron errors in mail
% cat /var/spool/mail/root

# View output from node script
% cat /tmp/cron.log
```

Following is `/etc/crontab`:

```
# Pull and process PEARL data every hour on the hour
0 * * * * root cd /home/ec2-user/pearl && /root/.nvm/versions/node/v15.5.0/bin/node ./worker.js > /tmp/cron.log
```

While the cron command was in `/etc/crontab`, it seems it could have equivalently been added by creating `/etc/cron.d/crontab`.

## S3 Permissions

Writing to S3, bucket ACL and CORS permissioning

https://stackoverflow.com/questions/17533888/s3-access-control-allow-origin-header

https://codeburst.io/javascript-async-await-with-foreach-b6ba62bbf404

## Conversion to TypeScript

```js
// Already importing ftp as:
const ftp = require("basic-ftp");

// But need to explicitly get FileInfo type for using in TypeScript
// First attempt was by doing the following, which worked
import { FileInfo } from "basic-ftp";
```

Although this causes TS compiler to add following line to top of compiled file:

```js
Object.defineProperty(exports, "__esModule", { value: true });
```

I'm not sure if this is particularly bad, but given my original JS didn't have it
I didn't see any reason why it should be there in compiled output
See: https://github.com/microsoft/TypeScript/issues/14351
That line seems to be because I'm using `import`.
Can solve replacing the import statement and following use of FileInfo as type in code
with using the following as my type, since ftp is already available via `require`

```js
typeof ftp.FileInfo
```

This solves compiler issues, but seems not to actually check the type!
For example I could just as well have done `typeof ftp.Foo` and it would have worked...

So maybe I need to go back to `import` style?

Is this fixed by the following `tsconfig.json`?

```json
{
  "compilerOptions": {
    "esModuleInterop": true,
    "module": "es2020"
  }
}
```

No.
It gets rid of the "problematic" line, but then Node cannot understand the `import` statements and errors when run with:

```
(node:92591) Warning: To load an ES module, set "type": "module" in the package.json or use the .mjs extension.
/Users/dpwiese/Code/dpwiese/php-ftp-chartjs/js/worker.js:2
import ftp from "basic-ftp";
^^^^^^

SyntaxError: Cannot use import statement outside a module
```

adding `"type": "module"` in `package.json` as directed reslts in the following when run:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/dpwiese/Code/dpwiese/php-ftp-chartjs/js/node_modules/aws-sdk/clients/s3' imported from /Users/dpwiese/Code/dpwiese/php-ftp-chartjs/js/worker.js
Did you mean to import aws-sdk/clients/s3.js?
```

Switched import to `import S3 from "aws-sdk/clients/s3.js";` as directed and got:

```
file:///Users/dpwiese/Code/dpwiese/php-ftp-chartjs/js/worker.js:1
require("dotenv").config();
^

ReferenceError: require is not defined
```

Now see [How do I use dotenv with import?](https://www.npmjs.com/package/dotenv#how-do-i-use-dotenv-with-import-)
Just did:

```js
import dotenv from "dotenv";
dotenv.config();
```

Concern is that `import`s are asynchronous while `require` are synchronous, and depends when `dotenv.config()` is called relative to loading.
Since none of the imports use environment variables, this should be OK as above.

Then get:

```
file:///Users/dpwiese/Code/dpwiese/php-ftp-chartjs/js/worker.js:5
const path = require("path");
             ^

ReferenceError: require is not defined
```

So replace all `require` with `import`.

Now typing an S3 type...

https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property

https://github.com/aws/aws-sdk-js/blob/master/lib/services/s3.d.ts

[Compiler Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html#compiler-options)

This was useful to prevent some errors:
`"esModuleInterop": true,`

Above seemed equivalent to reduce errors as:
`"allowSyntheticDefaultImports": true,`

Looking at docs, `esModuleInterop` turns on `allowSyntheticDefaultImports` and some other stuff.

Not sure about the following?

```json
{
  "compilerOptions": {
    "lib": [
      "es2016",
      "dom",
      "es5"
    ]
  }
}
```

Basically I think issue getting `import` syntax in TypeScript to compile to existing `require` in JavaScript is that I am trying to select some subsect only of previous ES spec?
That is, I want otherwise es2020 output, but with `require` - which seems not really a case that is supported?

https://stackoverflow.com/questions/31354559/using-node-js-require-vs-es6-import-export

But the `import` were only ever needed to import the types, specifically:

```js
// Types
import { FileInfo } from "basic-ftp";
import { ManagedUpload } from "aws-sdk/clients/s3.js";
```

For this to work, and using the rest `require` statements, I don't need `"type": "module"` in `package.json` and set `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "module": "commonjs",
  }
}
```

Don't need `"allowSyntheticDefaultImports": true` compiler option.
Result is just that in the compiled JavaScript there is the following line, that doesn't seem to hurt anything?

```js
Object.defineProperty(exports, "__esModule", { value: true });
```

### Converting Fully to ES6 Imports

1. Add `"type": "module"` to `package.json`
2. Set `tsconfig.json` as
    ```json
    {
      "compilerOptions": {
        "allowSyntheticDefaultImports": true,
        "module": "es2020",
      }
    }
    ```
3. Update `worker.ts` with the following
    ```js
    import dotenv from "dotenv";
    import ftp, { FileInfo } from "basic-ftp";
    import S3 from "aws-sdk/clients/s3.js";
    import fs from "fs";
    import path from "path";
    import parse from "csv-parse/lib/sync.js";

    dotenv.config();

    const s3 = new S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      apiVersion: "2006-03-01",
    });
    s3.config.region = AWS_REGION;
    ```

# References

[Apptio Blog: Can Amazon EC2’s Burstable T3s Optimize Costs?](https://www.apptio.com/blog/aws-ec2-t3-cost-optimization/)

> T3 instances feature the Intel Xeon Platinum 8000 series (Skylake-SP) processor with a sustained all core turbo CPU clock speed of up to 3.1 GHz.
> T3a instances feature the AMD EPYC 7000 series processor with an all core turbo CPU clock speed of up to 2.5 GHz.

[PHP CS Fixer](https://cs.symfony.com)

[Active FTP vs. Passive FTP, a Definitive Explanation](https://slacksite.com/other/ftp.html)

[Using and Running Node.js Modules in The Browser](https://www.techiediaries.com/how-to-bring-node-js-modules-to-the-browser/)
