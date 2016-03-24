class ActionPotential {
  constructor(sourceNeuron, destinyNeuron, skew, id, charge, neuronSize) {
    this.sourceNeuron = sourceNeuron;
    this.destinyNeuron = destinyNeuron;

    this.size = neuronSize/5;
    this.id = id;
    this.charge = charge;

    skew -= this.size/2;
    this.xCoord = sourceNeuron.xCoord + skew;
    this.yCoord = sourceNeuron.yCoord + skew;
    this.destinyX = destinyNeuron.xCoord + skew;
    this.destinyY = destinyNeuron.yCoord + skew;

    let length = Math.sqrt(Math.pow(this.destinyX-this.xCoord, 2) + Math.pow(this.destinyY-this.yCoord, 2));
    this.xSlope = (this.destinyX-this.xCoord)/length * 2;
    this.ySlope = (this.destinyY-this.yCoord)/length * 2;
    this.maxSteps = this.xSlope === 0 ? (this.destinyY-this.yCoord)/this.ySlope : (this.destinyX-this.xCoord)/this.xSlope;
    this.steps = 0;
  }


  display() {
    noStroke();

    this.charge > 0 ? fill(255) : fill(0);
    rect(this.xCoord, this.yCoord, this.size, this.size);
    this.move();
  }

  move() {
    this.xCoord += this.xSlope;
    this.yCoord += this.ySlope;
    this.steps++;

    if (this.steps >= this.maxSteps) {
      this.destinyNeuron.addCharge(this.charge);
      delete actionPotentialList[`${this.id}`];
    }
  }

  static displayAllActionPotentials() {
    let keys = _.keys(actionPotentialList);
    for(var i=0; i<keys.length;i++) {
      actionPotentialList[keys[i]].display();
    }
  }
}
