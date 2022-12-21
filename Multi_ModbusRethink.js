const { debug } = require("console");

main();

async function main() {
  var fs = require("fs").promises;
  var ModbusRTU = require("modbus-serial");
  var ModbusDevices = [];

  try {
    //legge il file di configurazione
    var con = await fs.readFile(`${__dirname}/config.json`);
    var config = JSON.parse(con);
    var iprethink = config.rethink["host"];
    var portrethink = config.rethink["port"];
    var dbrethink = config.rethink["db"];
    var devices = config.modbus;
    var debug = config.debug;
    if (debug) return { result: true, message: "Configurazione letta" };
    else console.log("Configurazione letta");
    //per ogni dispositivo presente nel file di configurazione
    for (var i = 0; i < devices.length; i++) {
      var id = devices[i]["id"];
      var host = devices[i]["host"];
      var porta = devices[i]["port"];
      var holding = devices[i]["holdingRead"];
      var coil = devices[i]["coilRead"];
      var holdingWrite = devices[i]["holdingWrite"];
      var coilWrite = devices[i]["coilWrite"];
      var clientModbus = new ModbusRTU();
      //crea un oggetto ModbusDevice
      ModbusDevices[i] = new ModbusDevice(
        id,
        host,
        porta,
        holding,
        coil,
        holdingWrite,
        coilWrite,
        clientModbus,
        iprethink,
        portrethink,
        dbrethink,
        debug
      );
      try {
        //connessione al dispositivo Modbus
        await ModbusDevices[i].clientModbus.connectTCP(host, {
          port: porta,
          timeout: 1000,
        });
        await ModbusDevices[i].clientModbus.setID(id);
        if (debug)
          return {
            result: true,
            message:
              "Connected to Modbus " + ModbusDevices[i].clientModbus.getID(),
          };
        else
          console.log(
            "Connected to Modbus " + ModbusDevices[i].clientModbus.getID()
          );
        ModbusDevices[i].GetChanges();
      } catch (err) {
        if (debug)
          return {
            result: false,
            message: "Modbus " + id + " is not connected",
          };
        else {
          console.error(err);
          console.log("Modbus " + id + " is not connected");
        }
      }
    }
  } catch (err) {
    if (debug)
      return {
        result: false,
        message: "Errore lettura file di configurazione",
      };
    else console.error(err);
  }

  if (ModbusDevices.length == 0) {
    if (debug) return { result: false, message: "No devices connected" };
    else {
      console.log("No devices connected");
      process.exit();
    }
  }
}

class ModbusDevice {
  constructor(
    id,
    host,
    porta,
    holding,
    coil,
    holdingWrite,
    coilWrite,
    clientModbus,
    iprethink,
    portrethink,
    dbrethink,
    debug
  ) {
    this.id = id;
    this.host = host;
    this.porta = porta;
    if (holdingWrite != "") holding = holding + "-" + holdingWrite;
    if (holding != "") this.holding = holding.split("-");
    else this.holding = "";
    if (coilWrite != "") coil = coil + "-" + coilWrite;
    if (coil != "") this.coil = coil.split("-");
    else this.coil = "";
    this.clientModbus = clientModbus;
    this.lettureHolding = [];
    this.lastLettureHolding = [];
    this.lettureCoil = [];
    this.rethinkdb = require("rethinkdb");
    this.iprethink = iprethink;
    this.portrethink = portrethink;
    this.dbrethink = dbrethink;
  }

  async GetChanges() {
    try {
      this.connection = await this.rethinkdb.connect({
        host: this.iprethink,
        port: this.portrethink,
        db: this.dbrethink,
      });
      if (debug) return { result: true, message: "Connected to RethinkDB" };
      else console.log("Connected to RethinkDB");
      await this.GetChangesRethink();
    } catch (err) {
      if (debug)
        return { result: false, message: "RethinkDB is not connected" };
      else console.error(err);
    }
    setInterval(async () => {
      await this.GetChangesModbus();
    }, 2500);
  }

  async GetChangesRethink() {
    try {
      var resultHold = await this.rethinkdb
        .table("holding")
        .filter({ idSlave: this.id })
        .changes()
        .run(this.connection);
      resultHold.each(async (err, row) => {
        if (err) {
          if (debug)
            return { result: false, message: "Errore lettura holding" };
          else console.error(err);
        } else {
          for (var i = 0; i < this.holdingWrite.length; i++) {
            if (this.holdingWrite[i].includes("/")) {
              var range = this.holdingWrite[i].split("/");
              var start = parseInt(range[0]);
              var end = parseInt(range[1]);
              for (var j = start; j <= end; j++) {
                if (row.new_val["register"] == j) {
                  var value = row.new_val["value"];
                  await this.clientModbus.writeRegister(j, value);
                }
              }
            } else {
              if (row.new_val["register"] == this.holdingWrite[i]) {
                var value = row.new_val["value"];
                await this.clientModbus.writeRegister(
                  this.holdingWrite[i],
                  value
                );
              }
            }
          }
        }
      });
      var resultCoil = await this.rethinkdb
        .table("coil")
        .filter({ idSlave: this.id })
        .changes()
        .run(this.connection);
      resultCoil.each(async (err, row) => {
        if (err) {
          if (debug) return { result: false, message: "Errore lettura coil" };
          else console.error(err);
        } else {
          for (var i = 0; i < this.coilWrite.length; i++) {
            if (this.coilWrite[i].includes("/")) {
              var range = this.coilWrite[i].split("/");
              var start = parseInt(range[0]);
              var end = parseInt(range[1]);
              for (var j = start; j <= end; j++) {
                if (row.new_val["register"] == j) {
                  var value = row.new_val["value"];
                  await this.clientModbus.writeCoil(j, value);
                }
              }
            } else {
              if (row.new_val["register"] == this.coilWrite[i]) {
                var value = row.new_val["value"];
                await this.clientModbus.writeCoil(this.coilWrite[i], value);
              }
            }
          }
        }
      });
    } catch (err) {
      if (debug)
        return { result: false, message: "Errore lettura coil e holding" };
      else console.error(err);
    }
  }

  async GetChangesModbus() {
    try {
      if (this.holding != "") {
        for (var i = 0; i < this.holding.length; i++) {
          if (this.holding[i].includes("/")) {
            var range = this.holding[i].split("/");
            var start = parseInt(range[0]);
            var end = parseInt(range[1]);
            var x;
            for (var j = start; j <= end; j++) {
              x = await this.clientModbus.readHoldingRegisters(j, 1);
              this.lettureHolding.push(j + ":" + x.data);
            }
          } else {
            x = await this.clientModbus.readHoldingRegisters(
              parseInt(this.holding[i]),
              1
            );
            this.lettureHolding.push(this.holding[i] + ":" + x.data);
          }
        }

        if (this.lettureHolding != this.lastLettureHolding) {
          for (var i = 0; i < this.lettureHolding.length; i++) {
            var lettura = this.lettureHolding[i].split(":");
            try {
              await this.rethinkdb
                .table("holding")
                .filter({ idSlave: this.id, register: lettura[0] })
                .isEmpty()
                .run(this.connection)
                .then(async (empty) => {
                  if (empty) {
                    this.rethinkdb
                      .table("holding")
                      .insert({
                        idSlave: this.id,
                        register: lettura[0],
                        value: lettura[1],
                      })
                      .run(this.connection);
                    if (debug)
                      return {
                        result: true,
                        message:
                          "Inserito nuovo valore holding SLAVE: " + this.id,
                      };
                    else {
                      console.log(lettura);
                      console.log(
                        "Inserito nuovo valore holding SLAVE: " + this.id
                      );
                    }
                  } else if (
                    this.lettureHolding[i] != this.lastLettureHolding[i]
                  ) {
                    this.rethinkdb
                      .table("holding")
                      .filter({ idSlave: this.id, register: lettura[0] })
                      .update({ value: lettura[1] })
                      .run(this.connection);
                    if (debug)
                      return {
                        result: true,
                        message: "Aggiornato valore holding SLAVE: " + this.id,
                      };
                    else {
                      console.log(lettura);
                      console.log(
                        "Aggiornato valore holding SLAVE: " + this.id
                      );
                    }
                  } else {
                    null;
                  }
                }, console.error);
            } catch (err) {
              if (debug)
                return {
                  result: false,
                  message: "Errore lettura holding",
                };
              else console.error(err);
            }
          }
        }
        this.lastLettureHolding = this.lettureHolding;
        this.lettureHolding = [];
      }

      if (this.coil != "") {
        for (var i = 0; i < this.coil.length; i++) {
          if (this.coil[i].includes("/")) {
            var range = this.coil[i].split("/");
            var start = parseInt(range[0]);
            var end = parseInt(range[1]);
            var x;
            for (var j = start; j <= end; j++) {
              x = await this.clientModbus.readCoils(j, 1);
              this.lettureCoil.push(j + ":" + x.data);
            }
          } else {
            x = await this.clientModbus.readCoils(parseInt(this.coil[i]), 1);
            this.lettureCoil.push(this.coil[i] + ":" + x.data);
          }
        }

        for (var i = 0; i < this.lettureCoil.length; i++) {
          var lettura = this.lettureCoil[i].split(":");
          try {
            await this.rethinkdb
              .table("coil")
              .filter({ idSlave: this.id, register: lettura[0] })
              .isEmpty()
              .run(this.connection)
              .then(async (empty) => {
                if (empty) {
                  this.rethinkdb
                    .table("coil")
                    .insert({
                      idSlave: this.id,
                      register: lettura[0],
                      value: lettura[1],
                    })
                    .run(this.connection);
                  if (debug)
                    return {
                      result: true,
                      message: "Inserito nuovo valore coil SLAVE: " + this.id,
                    };
                  else {
                    console.log(lettura);
                    console.log("Inserito nuovo valore coil SLAVE: " + this.id);
                  }
                } else if (this.lettureCoil[i] != this.lastLettureCoil[i]) {
                  this.rethinkdb
                    .table("coil")
                    .filter({ idSlave: this.id, register: lettura[0] })
                    .update({ value: lettura[1] })
                    .run(this.connection);
                  if (debug)
                    return {
                      result: true,
                      message: "Aggiornato valore coil SLAVE: " + this.id,
                    };
                  else {
                    console.log(lettura);
                    console.log("Aggiornato valore coil SLAVE: " + this.id);
                  }
                } else {
                  null;
                }
              }, console.error);
          } catch (err) {
            if (debug)
              return {
                result: false,
                message: "Errore lettura coil",
              };
            else console.error(err);
          }
        }
        this.lastLettureCoil = this.lettureCoil;
        this.lettureCoil = [];
      }
    } catch (err) {
      if (debug)
        return {
          result: false,
          message: "Errore lettura slave",
        };
      else console.error(err);
    }
  }
}
