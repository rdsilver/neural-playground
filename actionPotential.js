class ActionPotential {
  constructor(sourceNeuron, destinyNeuron, skew, id, charge, neuronSize) {
    this.sourceNeuron = sourceNeuron;
    this.destinyNeuron = destinyNeuron;

    this.size = neuronSize/sketchOptions.actionPotentialDivisor;
    this.id = id;
    this.charge = charge;

    skew -= this.size/2;
    this.x = sourceNeuron.x + skew;
    this.y = sourceNeuron.y + skew;
    this.destinyX = destinyNeuron.x + skew;
    this.destinyY = destinyNeuron.y + skew;

    let length = Math.sqrt(Math.pow(this.destinyX-this.x, 2) + Math.pow(this.destinyY-this.y, 2));
    this.xSlope = (this.destinyX-this.x)/length * 2;
    this.ySlope = (this.destinyY-this.y)/length * 2;
    this.maxSteps = this.xSlope === 0 ? (this.destinyY-this.y)/this.ySlope : (this.destinyX-this.x)/this.xSlope;
    this.steps = 0;
  }


  display() {
    noStroke();
    this.charge > 0 ? fill(255) : fill(0);
    rect(this.x, this.y, this.size, this.size);
    this.move();
  }

  move() {
    this.x += this.xSlope;
    this.y += this.ySlope;
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
