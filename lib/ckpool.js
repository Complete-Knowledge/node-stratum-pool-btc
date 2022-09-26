var events = require('events');
var async = require('async');

var varDiff = require('./varDiff.js');
var daemon = require('./daemon.js');
var peer = require('./peer.js');
var stratum = require('./stratum.js');
var jobManager = require('./ckjobManager.js');
var util = require('./util.js');

/*process.on('uncaughtException', function(err) {
    console.log(err.stack);
    throw err;
});*/

var pool = module.exports = function pool(options, authorizeFn){

    this.options = options;

    var _this = this;
    var blockPollingIntervalId;

    if (!(options.address)) {
      _this.newAddressOnNewBlock = true;
    }

    var emitLog        = function(text) { _this.emit('log', 'debug'  , text); };
    var emitWarningLog = function(text) { _this.emit('log', 'warning', text); };
    var emitErrorLog   = function(text) { _this.emit('log', 'error'  , text); };
    var emitSpecialLog = function(text) { _this.emit('log', 'special', text); };



    if (!(options.coin.algorithm in algos)){
        emitErrorLog('The ' + options.coin.algorithm + ' hashing algorithm is not supported.');
        throw new Error();
    }



    this.start = function(){
        SetupJobManager();
        StartStratumServer(function(){
            OutputPoolInfo();
            _this.emit('started');
        });
    };


    function OutputPoolInfo(){

        var startMessage = 'Stratum Pool Server Started for ' + options.coin.name +
            ' [' + options.coin.symbol.toUpperCase() + '] {' + options.coin.algorithm + '}';
        var infoLines = [startMessage,
                'Stratum Port(s):\t' 
        ];

        if (typeof options.updateWorkInterval === "number" && options.updateWorkInterval > 0)
            infoLines.push('Generating and sending work every:\t' + options.updateWorkInterval + ' ms');

        emitSpecialLog(infoLines.join('\n\t\t\t\t\t\t'));
    }

    /*
    Coin daemons either use submitblock or getblocktemplate for submitting new blocks
     */
    function SubmitBlock(blockHex, callback){
        emitLog("Found a PoW solution!, TODO : Submit on chain for verification")
        //TODO : get new randomness from the smart contract.
    }

    function SetupJobManager(){

        _this.jobManager = new jobManager(options);

        _this.jobManager.on('share', function(shareData){
            var isValidShare = !shareData.error;
            var emitShare = function(){
                _this.emit('share', isValidShare, false, shareData);
            };

            /*
            If we calculated that the block solution was found,
            before we emit the share, lets submit the block,
            then check if it was accepted using RPC getblock
            */
            if (!isValidBlock)
                emitShare();
            else{
                SubmitBlock(blockHex, function(){
                });
            }
        }).on('log', function(severity, message){
            _this.emit('log', severity, message);
        });
    }



    function StartStratumServer(finishedCallback){
        _this.stratumServer = new stratum.Server(options, authorizeFn);

        _this.stratumServer.on('started', function(){
            finishedCallback();

            if (typeof options.updateWorkInterval !== "number" || options.updateWorkInterval <= 0){
                emitLog('WOrk update polling has been disabled');
                return;
            }
    
            var pollingInterval = options.updateWorkInterval;
    
            updateWorkIntervalId = setInterval(function(){
                 _this.jobManager.generateNewWorkload();

            }, pollingInterval);

            _this.stratumServer.broadcastMiningJobs(_this.jobManager.currentWorkload);
            

        }).on('client.connected', function(client){
            
            client.on('difficultyChanged', function(diff){
                _this.emit('difficultyUpdate', client.workerName, diff);

            }).on('subscription', function(params, resultCallback){

                var extraNonce = _this.jobManager.extraNonceCounter.next();
                var extraNonce2Size = _this.jobManager.extraNonce2Size;
                resultCallback(null,
                    extraNonce,
                    extraNonce2Size
                );

                if (typeof(options.ports[client.socket.localPort]) !== 'undefined' && options.ports[client.socket.localPort].diff) {
                    this.sendDifficulty(options.ports[client.socket.localPort].diff);
                } else {
                    emitWarningLog("UNKNOWN PORT, sending default difficulty of 8 to the client!!")
                    this.sendDifficulty(8);
                }

                // this.sendMiningJob(_this.jobManager.currentJob.getJobParams());

            }).on('submit', function(params, resultCallback){
                var result =_this.jobManager.processShare(
                    params.jobId,
                    client.previousDifficulty,
                    client.difficulty,
                    client.extraNonce1,
                    params.extraNonce2,
                    params.nTime,
                    params.nonce,
                    client.remoteAddress,
                    client.socket.localPort,
                    params.name
                );

                resultCallback(result.error, result.result ? true : null);

            }).on('malformedMessage', function (message) {
                emitWarningLog('Malformed message from ' + client.getLabel() + ': ' + message);

            }).on('socketError', function(err) {
                emitWarningLog('Socket error from ' + client.getLabel() + ': ' + JSON.stringify(err));

            }).on('socketTimeout', function(reason){
                emitWarningLog('Connected timed out for ' + client.getLabel() + ': ' + reason)

            }).on('socketDisconnect', function() {
                //emitLog('Socket disconnected from ' + client.getLabel());

            }).on('kickedBannedIP', function(remainingBanTime){
                emitLog('Rejected incoming connection from ' + client.remoteAddress + ' banned for ' + remainingBanTime + ' more seconds');

            }).on('forgaveBannedIP', function(){
                emitLog('Forgave banned IP ' + client.remoteAddress);

            }).on('unknownStratumMethod', function(fullMessage) {
                emitLog('Unknown stratum method from ' + client.getLabel() + ': ' + fullMessage.method);

            }).on('socketFlooded', function() {
                emitWarningLog('Detected socket flooding from ' + client.getLabel());

            }).on('tcpProxyError', function(data) {
                emitErrorLog('Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: ' + data);

            }).on('bootedBannedWorker', function(){
                emitWarningLog('Booted worker ' + client.getLabel() + ' who was connected from an IP address that was just banned');

            }).on('triggerBan', function(reason){
                emitWarningLog('Banned triggered for ' + client.getLabel() + ': ' + reason);
                _this.emit('banIP', client.remoteAddress, client.workerName);
            });
        });
    }


    this.getStratumServer = function() {
        return _this.stratumServer;
    };

};
pool.prototype.__proto__ = events.EventEmitter.prototype;
