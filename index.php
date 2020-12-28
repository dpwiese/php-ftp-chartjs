<!DOCTYPE html>
<html>
  <head>
    <title>Line Chart</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@2.9.3"></script>
    <style>
    canvas{
      -moz-user-select: none;
      -webkit-user-select: none;
      -ms-user-select: none;
    }
    </style>
  </head>

  <body>
    <h1>PEARL Environmental Data</h1>

    <?php
      // Use Dotenv
      require __DIR__ . '/vendor/autoload.php';
      $dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
      $dotenv->load();

      // Set FTP credentials
      $ftp_server = $_ENV['FTP_SERVER'];
      $ftp_username = $_ENV['FTP_USERNAME'];
      $ftp_password = $_ENV['FTP_PASSWORD'];
      
      // Connect to FTP
      $ftp_conn = ftp_ssl_connect($ftp_server) or die("Couldn't connect to $ftp_server");
      $login = ftp_login($ftp_conn, $ftp_username, $ftp_password);

      // Turn on passive mode
      ftp_pasv($ftp_conn , true);

      // Get list of items
      $files = ftp_nlist($ftp_conn, "/inbound_wifi/");

      // Hold most recent files
      $recent_files = array();

      // Find recentish files by filename
      foreach ($files as $file) {
        if (strpos($file, 'SensorLog_2020-12-25') !== false) {
          array_push($recent_files, $file);
        }
        if (strpos($file, 'SensorLog_2020-12-26') !== false) {
          array_push($recent_files, $file);
        }
        if (strpos($file, 'SensorLog_2020-12-27') !== false) {
          array_push($recent_files, $file);
        }
      }
      sort($recent_files);

      $contents = '';

      $pearl_time = array();
      $pearl_speed = array();
      $pearl_bmp_temp = array();

      foreach ($recent_files as $file) {
        // Open file reader
        $h = fopen('php://temp', 'r+');

        // Read the file
        ftp_fget($ftp_conn, $h, $file, FTP_BINARY, 0);

        $fstats = fstat($h);
        fseek($h, 0);

        // Parse the CSV
        $arr = str_getcsv(fread($h, $fstats['size']));

        // Close file reader
        fclose($h);

        // Put contents of CSV into arrays
        for($i = 40; $i < count($arr); $i = $i + 39 * 1000) {
          array_push($pearl_time, $arr[$i]);
          array_push($pearl_speed, $arr[7 + $i]);
          array_push($pearl_bmp_temp, $arr[24 + $i]);
        }
      }

      // Close connection
      ftp_close($ftp_conn);
    ?>

    <div style="width:75%;">
      <canvas id="canvas"></canvas>
    </div>

    <script>
      const pearlTime = `<?php echo json_encode($pearl_time); ?>`;
      const pearlSpeed = `<?php echo json_encode($pearl_speed); ?>`;
      const pearlBmpTemp = `<?php echo json_encode($pearl_bmp_temp); ?>`;

      const pearlTimeArr = JSON.parse(pearlTime);
      const pearlSpeedArr = JSON.parse(pearlSpeed);
      const pearlBmpTempArr = JSON.parse(pearlBmpTemp);

      const config = {
        type: 'line',
        data: {
          labels: pearlTimeArr,
          datasets: [{
            label: 'BMP Temp',
            backgroundColor: 'rgb(255, 99, 132)',
            borderColor: 'rgb(255, 99, 132)',
            data: pearlBmpTempArr,
            fill: false,
          }, {
            label: 'Speed',
            fill: false,
            backgroundColor: 'rgb(54, 162, 235)',
            borderColor: 'rgb(54, 162, 235)',
            data: pearlSpeedArr,
          }]
        },
        options: {
          responsive: true,
          title: {
            display: true,
            text: 'PEARL Environmental Data'
          },
          tooltips: {
            mode: 'index',
            intersect: false,
          },
          hover: {
            mode: 'nearest',
            intersect: true
          },
          scales: {
            xAxes: [{
              display: true,
              scaleLabel: {
                display: true,
                labelString: 'Time'
              }
            }],
            yAxes: [{
              display: true,
              scaleLabel: {
                display: true,
                labelString: 'Temp / Speed'
              }
            }]
          }
        }
      };

      window.onload = function() {
        var ctx = document.getElementById('canvas').getContext('2d');
        window.myLine = new Chart(ctx, config);
      };
    </script>
  </body>
</html>
