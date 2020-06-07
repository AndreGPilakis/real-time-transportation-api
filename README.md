# Real-Time Transportation API 

This is the API for [Real-Time Transportation Map](https://github.com/JX-Siaw/real-time-transportation-map). It uses the [PTV Timetable API](https://timetableapi.ptv.vic.gov.au/swagger/ui/index#/) to generate the view required for the real-time transportation map.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. See deployment for notes on how to deploy the project on a live system.

```bash
1) Clone the project to your local machine
$ git clone https://github.com/JX-Siaw/real-time-transportation-api.git

2) Create an .env file to store the environment variables. Refer to .env_example as a guidance

3) Install the modules inside the project directory
$ npm install
```

### Prerequisites

You need to request your own API key for PTV Timetable API and set the environment variables for this API to work.

For more information on how to get an API Key:
[Click here](https://www.ptv.vic.gov.au/assets/default-site/footer/data-and-reporting/Datasets/PTV-Timetable-API/60096c0692/PTV-Timetable-API-key-and-signature-document.rtf)


### Running

To run the app in development mode,

```bash
1) Inside the project directory
$ set DEBUG=real-time-transportation-api:* && npm start

OR

To start the app with hot reload
$ set DEBUG=real-time-transportation-api:* && npm startdev
```

Once the app is running, open a browser and go to http://localhost:5000/check

If the response is:
```
{"securityTokenOK":true,"clientClockOK":true,"memcacheOK":true,"databaseOK":true}
```

This means the app is running,  and the connection between the API and PTV API is established

## Deployment

To deploy the app to a server
```bash
1) ssh into the server

2) Clone the project in the server
$ git clone https://github.com/JX-Siaw/real-time-transportation-api.git

3) Install modules
$ npm install

4) Run the app either with node or a process manager like PM2
$ npm start
```
``
Make sure a reverse proxy is set up allowing the web app to call the API at the designated port
``

## Built With

* [Express](https://expressjs.com/) - The framework used

## Authors

* **Jeremy Siaw** - *Initial work*
* **Ngoc Tran** - *Follow up work*
* **Sean Martin** - *Follow up work*
* **Andre Pilakis** - *Follow up work*


## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Acknowledgments

* Thanks to [Public Transport Victoria](https://www.ptv.vic.gov.au/footer/about-ptv/digital-tools-and-updates/) for providing access to their Timetable API's data
* Thanks to RMIT VXLab for providing access to the lab for development work and testing with the tiled displays
* Thanks to RMIT University for providing me the opportunity to work on the project
