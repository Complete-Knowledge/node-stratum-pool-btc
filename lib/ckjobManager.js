var events = require('events');
var crypto = require('crypto');

var bignum = require('bignum');



var util = require('./util.js');
var blockTemplate = require('./blockTemplate.js');



//Unique extranonce per subscriber
var ExtraNonceCounter = function(configInstanceId){

    var instanceId = configInstanceId || crypto.randomBytes(4).readUInt32LE(0);
    var counter = instanceId << 27;

    this.next = function(){
        var extraNonce = util.packUInt32BE(Math.abs(counter++));
        return extraNonce.toString('hex');
    };

    this.size = 4; //bytes
};

//Unique job per new block template
var JobCounter = function(){
    var counter = 0;

    this.next = function(){
        counter++;
        if (counter % 0xffff === 0)
            counter = 1;
        return this.cur();
    };

    this.cur = function () {
        return counter.toString(16);
    };
};

/**
 * Emits:
 * - newBlock(blockTemplate) - When a new block (previously unknown to the JobManager) is added, use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share. It will have blockHex if a block was found
**/
var JobManager = module.exports = function JobManager(options){


    //private members

    var _this = this;
    var jobCounter = new JobCounter();

    var shareMultiplier = algos[options.coin.algorithm].multiplier;
    
    //public members

    this.extraNonceCounter = new ExtraNonceCounter(options.instanceId);
    // this.extraNoncePlaceholder = new Buffer('f000000ff111111f', 'hex');
    this.extraNoncePlaceholder = new Buffer('f000000faa', 'hex');
    this.extraNonce2Size = this.extraNoncePlaceholder.length - this.extraNonceCounter.size;

    this.currentJob;
    this.validJobs = {};

    var hashDigest = algos[options.coin.algorithm].hash(options.coin);

    var coinbaseHasher = (function(){
        switch(options.coin.algorithm){
            case 'keccak':
            case 'fugue':
            case 'groestl':
                if (options.coin.normalHashing === true)
                    return util.sha256d;
                else
                    return util.sha256;
            default:
                return util.sha256d;
        }
    })();


    var blockHasher = (function () {
        switch (options.coin.algorithm) {
            case 'scrypt':
                if (options.coin.reward === 'POS') {
                    return function (d) {
                        return util.reverseBuffer(hashDigest.apply(this, arguments));
                    };
                }
            case 'scrypt-jane':
                if (options.coin.reward === 'POS') {
                    return function (d) {
                        return util.reverseBuffer(hashDigest.apply(this, arguments));
                    };
                }
            case 'scrypt-n':
                return function (d) {
                    return util.reverseBuffer(util.sha256d(d));
                };
            default:
                return function () {
                    return util.reverseBuffer(hashDigest.apply(this, arguments));
                };
        }
    })();


    this.generateNewWorkload = function() {
        job_id = jobCounter.next();
        generationTransaction0 = "01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff21"
        // 21 = nonce length(1) + sigma_response length(32 bytes)
        
        var sigma_response = util.sha256("todo").toString('hex');
        var generationTransaction1 = sigma_response + "ffffffff01bf20879500000000010100000000";
        
        // prev_hash = util.sha256("1").toString('hex');
        prev_hash = util.packUInt256(1).toString('hex'),
        workload = [
            jobCounter.next(),
            prev_hash,
            generationTransaction0,
            generationTransaction1,
            [],
            util.packInt32BE(1).toString('hex'),
            "1b15a845",
            util.packUInt32BE(1).toString('hex'),
            true
        ];
        if (jobCounter.cur() % 10 == 0) {
            console.log(workload);
        }
        _this.currentWorkload = workload;
    };

    

    this.processShare = function(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName){
        var shareError = function(error){
            _this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                extraNonce1: extraNonce1,
                extraNonce2: extraNonce2,
                error: error[1]
            });
            return {error: error, result: null};
        };

        var submitTime = Date.now() / 1000 | 0;

        if (extraNonce2.length / 2 !== _this.extraNonce2Size)
            return shareError([20, 'incorrect size of extranonce2']);

        var job = this.validJobs[jobId];

        if (typeof job === 'undefined' || job.jobId != jobId ) {
            return shareError([21, 'job not found, expecting ' + jobId + ' but got ' + job.jobId]);
        }

        if (nTime.length !== 8) {
            return shareError([20, 'incorrect size of ntime']);
        }

        // TODO: replace with appropriate current time

        var nTimeInt = parseInt(nTime, 16);
        // if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
        //     return shareError([20, 'ntime out of range']);
        // }

        if (nonce.length !== 8) {
            return shareError([20, 'incorrect size of nonce']);
        }

        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
            return shareError([22, 'duplicate share']);
        }


        var extraNonce1Buffer = new Buffer(extraNonce1, 'hex');
        var extraNonce2Buffer = new Buffer(extraNonce2, 'hex');

        var coinbaseBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);
        var coinbaseHash = coinbaseHasher(coinbaseBuffer);

        var merkleRoot = util.reverseBuffer(job.merkleTree.withFirst(coinbaseHash)).toString('hex');

        var headerBuffer = job.serializeHeader(merkleRoot, nTime, nonce);
        var headerHash = hashDigest(headerBuffer, nTimeInt);
        // var headerBigNum = bignum.fromBuffer(headerHash, {endian: 'little', size: 32});

        
        _this.emit('share', {
            job: jobId,
            extraNonce1: extraNonce1,
            extraNonce2: extraNonce2,
            ip: ipAddress,
            port: port,
            worker: workerName,
            difficulty: difficulty,
            headerhash: headerHash
        });
        
        return {result: true, error: null};
    };
};
JobManager.prototype.__proto__ = events.EventEmitter.prototype;
