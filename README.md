# PHP FTP ChartJS

This repo contains source code for a small project: create quasi-realtime charts on a Wordpress site from data periodically uploaded to an FTP server.
The most convenient approach would have been connecting to the FTP server from the browser to access, parse, and plot the data.
This would've created issues doing this securely without exposing the FTP credentials, and would have created performance limitations if there was a lot of data that needed to be parsed.
Furthermore, it seems browsers are dropping support for FTP anyway as described in the Chrome Platform Status [Feature: Deprecate FTP support (deprecated)](https://www.chromestatus.com/feature/6246151319715840) page, on the Bugzilla ticket [Remove FTP support](https://bugzilla.mozilla.org/show_bug.cgi?id=1574475), as well as in the Mozilla Blog [What to expect for the upcoming deprecation of FTP in Firefox](https://blog.mozilla.org/addons/2020/04/13/what-to-expect-for-the-upcoming-deprecation-of-ftp-in-firefox/).
Now, browsers like Safari 14 and Chrome 87 both launch the built-in file manager when attempting to access an FTP server.
It seems [XMLHttpRequest](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest) used to be a potential option, as described in the [2014 documentation](https://web.archive.org/web/20141205110759/https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest):

> Despite its name, `XMLHttpRequest` can be used to retrieve any type of data, not just XML, and it supports protocols other than HTTP (including file and ftp).

However, that is no longer the case. Basically, all this meant that if the FTP needed to be accessed, it needed to be done server-side.

This was a more sensible implementation for the reasons described above - FTP credentials could be hidden from the user, and computation could be more performant server-side.

# EC2 FTP Server

As a first step, I wanted to create my own simple FTP server which I could use to develop and test against.
My first thought was to see if AWS offered a simple easy to user FTP server and found [AWS Transfer Family](https://aws.amazon.com/aws-transfer-family/).
This seemed like a convenient option:

> Simple and seamless file transfer to Amazon S3 using SFTP, FTPS, and FTP

But at $0.30 per hour just to have the FTP endpoint enabled was about $216/month which was way too much.
There didn't seem to be any other good cheap or free FTP servers for such a project - just somewhere to throw a few megabytes of data and test reading the data from an FTP client.
EC2 seemed like a convenient and flexible way to go.

Check the EC2 [On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/) a t3a.nano is $0.0047 per Hour or less than $3.50/month.
After launching the instance the following links were helpful to connect:
[Connect to your Linux instance using an SSH client](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AccessingInstancesLinux.html) and [Get information about your instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connection-prereqs.html#connection-prereqs-get-info-about-instance) which said:

> For Amazon Linux 2 or the Amazon Linux AMI, the user name is `ec2-user`.

To connect via SSH with the downloaded key, the following command is used:

```sh
% ssh -i "/Users/dpwiese/Library/Mobile Documents/com~apple~CloudDocs/programming/keys-and-security/dpwiese-aws-ec2-t2a-nano.pem" ec2-user@3.216.36.9
```

With a new EC2 instance created, I now needed to start an FTP server.

# Setting up FTP

The post [How to Configure FTP on AWS EC2](https://medium.com/tensult/configure-ftp-on-aws-ec2-85b5b56b9c94) was one of the first ones to show up in search, and had the few simple steps to follow to install and configure [vsftpd](https://security.appspot.com/vsftpd.html).

```sh
# Edit vsftpd configuration
% sudo nano /etc/vsftpd/vsftpd.conf

# Restart vsftpd
% sudo systemctl restart vsftpd
```

Default directory when connecting contained a single subdirectory `pub` which is found using the following command:

```sh
# Find the folder: /var/ftp/pub
% find / -name pub
```

Having following the steps in the post above, the FTP server was ready to develop and test against.

# PHP Setup

Running PHP webserver to serve locally

```sh
% php -S 127.0.0.1:8000
% php -S 127.0.0.1:8000 index.php
% php -S 127.0.0.1:8000 -t ./
```

Dependency management is handled with [composer](https://getcomposer.org/).
The first dependency that was installed was [PHP dotenv](https://github.com/vlucas/phpdotenv) to store the FTP credentials in environment variables.

```sh
# /usr/local/bin/composer
% which composer

# Install
% composer install
```

With minimal effort, `index.php` was served up locally, containing the code to connect to the FTP server, read and parse the data, and then pass it to JavaScript for plotting with [Chart.js](https://www.chartjs.org).

Note in the code below the backtick for using multiline string, since when this example was first implemented `$bar` were the contents of a file, including newlines, which created an error `Uncaught SyntaxError: Invalid or unexpected token`.

```html
<script type="text/javascript">
  var foo = `<?php echo $bar; ?>`;
  console.log(foo);
</script>
```

# References

[Apptio Blog: Can Amazon EC2’s Burstable T3s Optimize Costs?](https://www.apptio.com/blog/aws-ec2-t3-cost-optimization/)

> T3 instances feature the Intel Xeon Platinum 8000 series (Skylake-SP) processor with a sustained all core turbo CPU clock speed of up to 3.1 GHz. T3a instances feature the AMD EPYC 7000 series processor with an all core turbo CPU clock speed of up to 2.5 GHz.
