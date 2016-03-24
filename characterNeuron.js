class CharacterNeuron extends Neuron {
  constructor(x, y, neuronSize, actlvl) {
    super(x, y, neuronSize, actlvl);
    this.charIndex = [0,1,2,3,4,5,6,7,8,9,'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
  }

  display() {
    this.selected ? fill(200, 200, 60) : fill(255, 255, 255);
    stroke(sketchOptions.gridColor);
    rect(this.xCoord, this.yCoord, this.size, this.size);
    fill(0);
    textAlign(CENTER);
    textSize(this.size);

    let letter = '';
    this.curCharge < 0 ? letter = this.curCharge : letter = this.charIndex[this.curCharge];
    text(letter, this.xCoord + this.size/2, this.yCoord + this.size/1.15);
  }
}
